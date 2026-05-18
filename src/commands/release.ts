import path from 'node:path'

import type { BundleManifest } from '../bundle'
import { resolveProjectRuntimeVersion } from '../bundle'
import { readBooleanOption, readStringOption } from '../cli/args'
import {
  assertReleaseContextMatchesConfig,
  openBundleArchive,
  readBundleManifest,
  readBundleManifestIfExists,
  resolveApiConfig,
  resolveManifestDefaultRuntimeVersion,
  resolveManifestRuntimeVersion,
  resolveManifestPlatform,
  resolvePlatform,
  resolveProject,
  type CommandContext,
} from '../cli/helpers'
import {
  formatBundleSummary,
  formatIngestSummary,
  formatPublishSummary,
  formatReleaseContextSummary,
  printBundlesTable,
} from '../cli/output'
import { promptSelectWithHint, promptWithHint } from '../cli/prompts'
import type { MobilePlatform } from '../config'
import {
  type BundleIngestItem,
  type ReleaseItem,
  cancelReleaseUpload,
  completeReleaseUpload,
  createReleaseUploadIntent,
  getReleaseIngest,
  listReleases,
  pauseRelease,
  rollbackRelease,
  resumeRelease,
  uploadReleaseArchive,
} from '../http'

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

const PLATFORM_OPTIONS = [
  { label: 'ios', value: 'ios' },
  { label: 'android', value: 'android' },
] as const satisfies ReadonlyArray<{ label: string, value: MobilePlatform }>
const INGEST_POLL_INTERVAL_MS = 2_000
const INGEST_WAIT_TIMEOUT_MS = 10 * 60_000

async function resolveReleaseAccess(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)

  const releaseContext = await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })

  for (const line of formatReleaseContextSummary(releaseContext, {
    name: project.appName,
    appId: project.appId,
  }).split('\n')) {
    console.log(line)
  }

  console.log('')

  return {
    api,
    project,
  }
}

function resolveOutputDir(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  return path.resolve(
    context.cwd,
    readStringOption(options, 'output-dir') ?? '.otalan/bundle',
  )
}

async function resolveDefaultRuntimeVersion(
  context: CommandContext,
  options: Record<string, string | boolean>,
  platform: MobilePlatform,
) {
  const manifest = await readBundleManifestIfExists(resolveOutputDir(context, options))

  return readStringOption(options, 'runtime-version')
    ?? resolveManifestDefaultRuntimeVersion(manifest, platform)
    ?? await resolveProjectRuntimeVersion(context.cwd, platform).catch(async () => promptWithHint({
      question: 'Runtime version',
      hint: 'Exact runtime version.',
    }))
}

function resolveRolloutPercent(options: Record<string, string | boolean>) {
  const rolloutPercent = Number(readStringOption(options, 'rollout-percent') ?? '100')

  if (
    Number.isNaN(rolloutPercent)
    || !Number.isInteger(rolloutPercent)
    || rolloutPercent < 0
    || rolloutPercent > 100
  ) {
    throw new Error('rollout-percent must be an integer between 0 and 100.')
  }

  return rolloutPercent
}

async function promptPlatformChoice() {
  return promptSelectWithHint({
    question: 'Platform',
    hint: 'Target mobile platform: ios or android.',
    options: PLATFORM_OPTIONS,
  })
}

async function resolveReleaseTupleFromManifest(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const outputDir = resolveOutputDir(context, options)
  const manifest = await readBundleManifest(outputDir)
  const platform = resolveManifestPlatform(
    manifest,
    readStringOption(options, 'platform'),
  )
  const runtimeVersion = resolveManifestRuntimeVersion(
    manifest,
    readStringOption(options, 'runtime-version'),
  )
  const channel = readStringOption(options, 'channel') ?? await promptWithHint({
    question: 'Channel',
    fallback: 'production',
    hint: 'Release channel.',
  })

  return {
    outputDir,
    manifest,
    platform,
    runtimeVersion,
    channel,
  }
}

async function resolveRemoteReleaseTuple(
  context: CommandContext,
  options: Record<string, string | boolean>,
  channelHint: string,
) {
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptPlatformChoice()
  const platform = resolvePlatform(options, platformFallback)
  const runtimeVersion = readStringOption(options, 'runtime-version')
    ?? await resolveDefaultRuntimeVersion(context, options, platform)
  const channel = readStringOption(options, 'channel') ?? await promptWithHint({
    question: 'Channel',
    fallback: 'production',
    hint: channelHint,
  })

  return {
    platform,
    runtimeVersion,
    channel,
  }
}

function resolveManifestExpoPublishMetadata(manifest: BundleManifest) {
  if (manifest.target !== 'expo') {
    return undefined
  }

  return JSON.stringify(manifest)
}

function isTerminalIngestStatus(status: string) {
  return status === 'ready' || status === 'failed'
}

async function resolveRollbackTargetBundleId(input: {
  options: Record<string, string | boolean>
  releases: ReleaseItem[]
  promptTargetBundleId?: (example: string) => Promise<string>
}) {
  const targetBundleId = readStringOption(input.options, 'bundle-id')
    ?? readStringOption(input.options, 'target-bundle-id')

  if (targetBundleId) {
    return targetBundleId
  }

  const example = input.releases.find(item => item.resolvedDownloadUrl)?.bundleId ?? '1.0.0-web.1'

  console.log('')
  console.log('Available bundles')
  console.log('')
  printBundlesTable(input.releases)

  if (input.promptTargetBundleId) {
    return input.promptTargetBundleId(example)
  }

  return promptWithHint({
    question: 'Target bundle ID',
    hint: 'Published bundle ID to reactivate.',
    example,
  })
}

async function waitForReleaseIngest(input: {
  ingest: BundleIngestItem
  loadIngest: (ingestId: string) => Promise<BundleIngestItem>
  onStatusChange?: (ingest: BundleIngestItem) => void
  pollIntervalMs?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}) {
  const pollIntervalMs = input.pollIntervalMs ?? INGEST_POLL_INTERVAL_MS
  const timeoutMs = input.timeoutMs ?? INGEST_WAIT_TIMEOUT_MS
  const sleep = input.sleep ?? Bun.sleep
  const now = input.now ?? Date.now
  const startedAt = now()
  let ingest = input.ingest

  while (!isTerminalIngestStatus(ingest.status)) {
    if (now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for release validation. Ingest ${ingest.id} is still ${ingest.status}.`)
    }

    await sleep(pollIntervalMs)

    const nextIngest = await input.loadIngest(ingest.id)

    if (nextIngest.status !== ingest.status) {
      input.onStatusChange?.(nextIngest)
    }

    ingest = nextIngest
  }

  return ingest
}

// -----------------------------------------------------------------------------
// Release commands
// -----------------------------------------------------------------------------

export async function handlePublish(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const { outputDir, manifest, platform, runtimeVersion, channel } = await resolveReleaseTupleFromManifest(context, options)
  const mandatory = !readBooleanOption(options, 'optional', false)
  const rolloutPercent = resolveRolloutPercent(options)
  const releaseNotes = readStringOption(options, 'release-notes')
  const archive = await openBundleArchive(outputDir, manifest)
  const uploadIntent = await createReleaseUploadIntent({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
    bundleId: manifest.bundleId,
    mandatory,
    rolloutPercent,
    releaseNotes,
    fileName: archive.fileName,
    fileSizeBytes: archive.fileSizeBytes,
    contentType: archive.contentType,
    expoManifest: resolveManifestExpoPublishMetadata(manifest),
  })

  try {
    await uploadReleaseArchive({
      uploadUrl: uploadIntent.uploadUrl,
      archive: archive.body,
      contentType: uploadIntent.contentType,
    })
  } catch (error) {
    await cancelReleaseUpload({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
      ingestId: uploadIntent.item.id,
    }).catch(() => undefined)

    throw error
  }

  const ingest = await completeReleaseUpload({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    ingestId: uploadIntent.item.id,
  })

  console.log('')
  console.log(formatPublishSummary({
    bundleId: manifest.bundleId,
    platform,
    channel,
    runtimeVersion,
    rolloutPercent,
    mandatory,
    releaseNotes,
  }))
  console.log('')
  console.log(formatIngestSummary({
    ingest,
  }))
  console.log('')
  console.log('Waiting for validation...')

  const completedIngest = await waitForReleaseIngest({
    ingest,
    loadIngest: ingestId =>
      getReleaseIngest({
        apiUrl: api.apiUrl,
        apiKey: api.apiKey,
        ingestId,
      }),
    onStatusChange: nextIngest => {
      console.log(`Ingest status: ${nextIngest.status}`)
    },
  })

  if (completedIngest.status === 'failed') {
    if (completedIngest.failureReason) {
      throw new Error(`Release validation failed for ingest ${completedIngest.id}: ${completedIngest.failureReason}`)
    }

    throw new Error(`Release validation failed for ingest ${completedIngest.id}.`)
  }

  console.log('')
  console.log('Release published.')
  console.log('')
  console.log(formatIngestSummary({
    ingest: completedIngest,
  }))
}

export async function handleRollback(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const { platform, runtimeVersion, channel } = await resolveRemoteReleaseTuple(
    context,
    options,
    'Release channel for this rollback.',
  )

  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
  })
  const targetBundleId = await resolveRollbackTargetBundleId({
    options,
    releases,
  })

  const targetRelease = releases.find(item => item.bundleId === targetBundleId)

  if (!targetRelease) {
    throw new Error(`Bundle "${targetBundleId}" was not found for the selected platform, channel, and runtimeVersion.`)
  }

  if (!targetRelease.resolvedDownloadUrl) {
    throw new Error(`Bundle "${targetBundleId}" archive is unavailable and cannot be rolled back.`)
  }

  const item = await rollbackRelease({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
    targetBundleId,
  })

  console.log('')
  console.log('Rollback applied.')
  console.log('')
  console.log(formatBundleSummary({
    bundleId: item.bundleId,
    platform: item.platform,
    channel: item.channel,
    runtimeVersion: item.runtimeVersion,
    rolloutPercent: item.rolloutPercent,
    rolloutState: item.rolloutState,
    releaseNotes: item.releaseNotes,
    publishedAt: item.publishedAt,
    selectable: Boolean(item.resolvedDownloadUrl),
  }))
}

async function handleRolloutStateChange(
  context: CommandContext,
  options: Record<string, string | boolean>,
  action: 'pause' | 'resume',
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const { platform, runtimeVersion, channel } = await resolveRemoteReleaseTuple(
    context,
    options,
    `Release channel to ${action}.`,
  )
  const updateRolloutState = action === 'pause' ? pauseRelease : resumeRelease
  const item = await updateRolloutState({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
  })

  console.log('')
  console.log(action === 'pause' ? 'Rollout paused.' : 'Rollout resumed.')
  console.log('')
  console.log(formatBundleSummary({
    bundleId: item.bundleId,
    platform: item.platform,
    channel: item.channel,
    runtimeVersion: item.runtimeVersion,
    rolloutPercent: item.rolloutPercent,
    rolloutState: item.rolloutState,
    releaseNotes: item.releaseNotes,
    publishedAt: item.publishedAt,
    selectable: Boolean(item.resolvedDownloadUrl),
  }))
}

export async function handlePause(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  await handleRolloutStateChange(context, options, 'pause')
}

export async function handleResume(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  await handleRolloutStateChange(context, options, 'resume')
}

export async function handleStatus(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const { platform, runtimeVersion, channel } = await resolveRemoteReleaseTuple(
    context,
    options,
    'Release channel.',
  )

  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
  })
  const active = releases.find(item => item.isActive) ?? null

  if (!active) {
    console.log('No active bundle found for the selected platform, channel, and runtimeVersion.')
    return
  }

  console.log('Active bundle')
  console.log('')
  console.log(formatBundleSummary({
    bundleId: active.bundleId,
    platform: active.platform,
    channel: active.channel,
    runtimeVersion: active.runtimeVersion,
    rolloutPercent: active.rolloutPercent,
    rolloutState: active.rolloutState,
    releaseNotes: active.releaseNotes,
    publishedAt: active.publishedAt,
    selectable: Boolean(active.resolvedDownloadUrl),
  }))
}

export async function handleBundlesList(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const { platform, runtimeVersion, channel } = await resolveRemoteReleaseTuple(
    context,
    options,
    'Release channel.',
  )

  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
  })

  printBundlesTable(releases)
}

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

export const releaseTestUtils = {
  isTerminalIngestStatus,
  resolveRollbackTargetBundleId,
  resolveRolloutPercent,
  waitForReleaseIngest,
}
