import path from 'node:path'

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
import type { MobilePlatform } from '../config'
import {
  createRelease,
  listReleases,
  publishRelease,
  rollbackRelease,
} from '../http'
import {
  formatBundleSummary,
  formatPublishSummary,
  printBundlesTable,
} from '../cli/output'
import { promptWithHint } from '../cli/prompts'

export async function handlePublish(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)
  await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })
  const outputDir = path.resolve(
    context.cwd,
    readStringOption(options, 'output-dir') ?? '.otalan/bundle',
  )
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
    hint: 'Release channel to publish to.',
  })
  const mandatory = !readBooleanOption(options, 'optional', false)
  const rolloutPercent = Number(readStringOption(options, 'rollout-percent') ?? '100')
  const releaseNotes = readStringOption(options, 'release-notes')

  if (Number.isNaN(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
    throw new Error('rollout-percent must be between 0 and 100.')
  }

  if (readStringOption(options, 'storage-key') || readStringOption(options, 'download-url')) {
    await publishRelease({
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
      storageKey: readStringOption(options, 'storage-key'),
      downloadUrl: readStringOption(options, 'download-url'),
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
    return
  }

  const file = await readBundleFile(outputDir)
  await createRelease({
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
}

async function resolveDefaultNativeVersion(
  context: CommandContext,
  options: Record<string, string | boolean>,
  platform: MobilePlatform,
) {
  const outputDir = path.resolve(
    context.cwd,
    readStringOption(options, 'output-dir') ?? '.otalan/bundle',
  )
  const manifest = await readBundleManifestIfExists(outputDir)

  return readStringOption(options, 'native-version')
    ?? resolveManifestDefaultNativeVersion(manifest, platform)
    ?? await resolveProjectNativeVersion(context.cwd, platform).catch(async () => promptWithHint({
      question: 'Native version',
      hint: 'Exact native app version.',
    }))
}

export async function handleRollback(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)
  await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })
  const targetBundleId = readStringOption(options, 'bundle-id')
    ?? readStringOption(options, 'target-bundle-id')
    ?? await promptWithHint({
      question: 'Target bundle ID',
      hint: 'Published bundle ID to reactivate.',
      example: '1.0.0-web.1',
    })
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptWithHint({
      question: 'Platform',
      hint: 'Target mobile platform: ios or android.',
    }) as MobilePlatform
  const platform = resolvePlatform(
    options,
    platformFallback,
  )
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

  await rollbackRelease({
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
    bundleId: targetRelease.bundleId,
    platform: targetRelease.platform,
    channel: targetRelease.channel,
    nativeVersion: targetRelease.nativeVersion,
    rolloutPercent: targetRelease.rolloutPercent,
    rolloutState: 'active',
    releaseNotes: targetRelease.releaseNotes,
    createdAt: targetRelease.createdAt,
    selectable: true,
  }))
}

export async function handleStatus(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)
  await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptWithHint({
      question: 'Platform',
      hint: 'Target mobile platform: ios or android.',
    }) as MobilePlatform
  const platform = resolvePlatform(
    options,
    platformFallback,
  )
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

export async function handleBundlesList(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)
  await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptWithHint({
      question: 'Platform',
      hint: 'Target mobile platform: ios or android.',
    }) as MobilePlatform
  const platform = resolvePlatform(
    options,
    platformFallback,
  )
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
