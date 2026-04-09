import path from 'node:path'

import type { BundleManifest } from '../bundle'
import { resolveProjectNativeVersion } from '../bundle'
import { readBooleanOption, readStringOption } from '../cli/args'
import {
  assertReleaseContextMatchesConfig,
  readBundleFile,
  readBundleManifest,
  readBundleManifestIfExists,
  resolveApiConfig,
  resolveManifestDefaultNativeVersion,
  resolveManifestNativeVersion,
  resolveManifestPlatform,
  resolvePlatform,
  resolveProject,
  type CommandContext,
} from '../cli/helpers'
import {
  formatBundleSummary,
  formatPublishSummary,
  formatUploadSummary,
  printBundlesTable,
} from '../cli/output'
import { promptSelectWithHint, promptWithHint } from '../cli/prompts'
import type { MobilePlatform } from '../config'
import {
  createRelease,
  listReleases,
  publishRelease,
  rollbackRelease,
  uploadReleaseArchive,
} from '../http'

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

const PLATFORM_OPTIONS = [
  { label: 'ios', value: 'ios' },
  { label: 'android', value: 'android' },
] as const satisfies ReadonlyArray<{ label: string, value: MobilePlatform }>

async function resolveReleaseAccess(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)

  await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })

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

async function resolveDefaultNativeVersion(
  context: CommandContext,
  options: Record<string, string | boolean>,
  platform: MobilePlatform,
) {
  const manifest = await readBundleManifestIfExists(resolveOutputDir(context, options))

  return readStringOption(options, 'native-version')
    ?? resolveManifestDefaultNativeVersion(manifest, platform)
    ?? await resolveProjectNativeVersion(context.cwd, platform).catch(async () => promptWithHint({
      question: 'Native version',
      hint: 'Exact native app version.',
    }))
}

function resolveRolloutPercent(options: Record<string, string | boolean>) {
  const rolloutPercent = Number(readStringOption(options, 'rollout-percent') ?? '100')

  if (Number.isNaN(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
    throw new Error('rollout-percent must be between 0 and 100.')
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
  const nativeVersion = resolveManifestNativeVersion(
    manifest,
    readStringOption(options, 'native-version'),
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
    nativeVersion,
    channel,
  }
}

function resolveManifestExpoConfig(manifest: BundleManifest) {
  if (manifest.target !== 'expo') {
    return undefined
  }

  return manifest.expoConfig
}

// -----------------------------------------------------------------------------
// Release commands
// -----------------------------------------------------------------------------

export async function handleUpload(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const { outputDir, manifest, platform, nativeVersion, channel } = await resolveReleaseTupleFromManifest(context, options)
  const file = await readBundleFile(outputDir)
  const upload = await uploadReleaseArchive({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    nativeVersion,
    bundleId: manifest.bundleId,
    file,
    expoConfig: resolveManifestExpoConfig(manifest),
  })

  console.log('')
  console.log('Bundle uploaded.')
  console.log('')
  console.log(formatUploadSummary({
    bundleId: manifest.bundleId,
    platform,
    channel,
    nativeVersion,
    upload,
  }))
}

export async function handlePublish(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const { outputDir, manifest, platform, nativeVersion, channel } = await resolveReleaseTupleFromManifest(context, options)
  const mandatory = !readBooleanOption(options, 'optional', false)
  const rolloutPercent = resolveRolloutPercent(options)
  const releaseNotes = readStringOption(options, 'release-notes')
  const storageKey = readStringOption(options, 'storage-key')
  const downloadUrl = readStringOption(options, 'download-url')

  if (storageKey && downloadUrl) {
    throw new Error('Pass either --storage-key or --download-url, not both.')
  }

  if (storageKey || downloadUrl) {
    const item = await publishRelease({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
      appId: project.appId,
      platform,
      channel,
      nativeVersion,
      bundleId: manifest.bundleId,
      checksum: manifest.hash,
      mandatory,
      rolloutPercent,
      releaseNotes,
      storageKey,
      downloadUrl,
      expoConfig: resolveManifestExpoConfig(manifest),
    })

    console.log('')
    console.log('Release published.')
    console.log('')
    console.log(formatPublishSummary({
      bundleId: manifest.bundleId,
      platform,
      channel,
      nativeVersion,
      rolloutPercent,
      mandatory,
      releaseNotes,
    }))

    if (item.storageKey || item.downloadUrl) {
      console.log('')
      console.log(`Source: ${item.storageKey ?? item.downloadUrl}`)
    }

    return
  }

  const file = await readBundleFile(outputDir)
  const created = await createRelease({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    nativeVersion,
    bundleId: manifest.bundleId,
    mandatory,
    rolloutPercent,
    releaseNotes,
    file,
    expoConfig: resolveManifestExpoConfig(manifest),
  })

  console.log('')
  console.log('Release published.')
  console.log('')
  console.log(formatPublishSummary({
    bundleId: manifest.bundleId,
    platform,
    channel,
    nativeVersion,
    rolloutPercent,
    mandatory,
    releaseNotes,
  }))
  console.log('')
  console.log(formatUploadSummary({
    bundleId: manifest.bundleId,
    platform,
    channel,
    nativeVersion,
    upload: created.upload,
  }))
}

export async function handleRollback(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const targetBundleId = readStringOption(options, 'bundle-id')
    ?? readStringOption(options, 'target-bundle-id')
    ?? await promptWithHint({
      question: 'Target bundle ID',
      hint: 'Published bundle ID to reactivate.',
      example: '1.0.0-web.1',
    })
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptPlatformChoice()
  const platform = resolvePlatform(options, platformFallback)
  const nativeVersion = readStringOption(options, 'native-version')
    ?? await resolveDefaultNativeVersion(context, options, platform)
  const channel = readStringOption(options, 'channel') ?? await promptWithHint({
    question: 'Channel',
    fallback: 'production',
    hint: 'Release channel for this rollback.',
  })

  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    nativeVersion,
  })
  const targetRelease = releases.find(item => item.bundleId === targetBundleId)

  if (!targetRelease) {
    throw new Error(`Bundle "${targetBundleId}" was not found for the selected platform, channel, and nativeVersion.`)
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
    nativeVersion,
    targetBundleId,
  })

  console.log('')
  console.log('Rollback applied.')
  console.log('')
  console.log(formatBundleSummary({
    bundleId: item.bundleId,
    platform: item.platform,
    channel: item.channel,
    nativeVersion: item.nativeVersion,
    rolloutPercent: item.rolloutPercent,
    rolloutState: item.rolloutState,
    releaseNotes: item.releaseNotes,
    createdAt: item.createdAt,
    selectable: Boolean(item.resolvedDownloadUrl),
  }))
}

export async function handleStatus(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptPlatformChoice()
  const platform = resolvePlatform(options, platformFallback)
  const nativeVersion = readStringOption(options, 'native-version')
    ?? await resolveDefaultNativeVersion(context, options, platform)
  const channel = readStringOption(options, 'channel') ?? await promptWithHint({
    question: 'Channel',
    fallback: 'production',
    hint: 'Release channel.',
  })

  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    nativeVersion,
  })
  const active = releases.find(item => item.isActive) ?? null

  if (!active) {
    console.log('No active bundle found for the selected platform, channel, and nativeVersion.')
    return
  }

  console.log('Active bundle')
  console.log('')
  console.log(formatBundleSummary({
    bundleId: active.bundleId,
    platform: active.platform,
    channel: active.channel,
    nativeVersion: active.nativeVersion,
    rolloutPercent: active.rolloutPercent,
    rolloutState: active.rolloutState,
    releaseNotes: active.releaseNotes,
    createdAt: active.createdAt,
    selectable: Boolean(active.resolvedDownloadUrl),
  }))
}

export async function handleBundlesList(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const { api, project } = await resolveReleaseAccess(context, options)
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptPlatformChoice()
  const platform = resolvePlatform(options, platformFallback)
  const channel = readStringOption(options, 'channel') ?? await promptWithHint({
    question: 'Channel',
    fallback: 'production',
    hint: 'Release channel.',
  })
  const nativeVersion = readStringOption(options, 'native-version')
    ?? await resolveDefaultNativeVersion(context, options, platform)

  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    nativeVersion,
  })

  printBundlesTable(releases)
}
