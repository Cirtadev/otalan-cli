import { readStringOption } from '../cli/args'
import type { CommandContext } from '../cli/helpers'
import {
  formatBundleSummary,
  printBundlesTable,
  printChannelsTable,
} from '../cli/output'
import { formatHeading, formatInfo, printSuccess } from '../cli/ui'
import {
  listReleaseChannels,
  listReleases,
  pauseRelease,
  resumeRelease,
  rollbackRelease,
} from '../http'
import {
  resolveChannelsAppId,
  formatReleasePaginationSummary,
  resolveReleaseAccess,
  resolveReleaseProjectAccess,
  resolveRemoteReleaseTuple,
  resolveReleasePaginationOptions,
  resolveRollbackTargetBundleId,
  type ChannelsListDependencies,
} from './release-shared'

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
  const explicitTargetBundleId = readStringOption(options, 'bundle-id')
    ?? readStringOption(options, 'target-bundle-id')
  const releasePage = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
    ...(explicitTargetBundleId
      ? { bundleId: explicitTargetBundleId }
      : resolveReleasePaginationOptions(options)),
  })
  const releases = releasePage.items

  if (releases.length === 0 && !explicitTargetBundleId) {
    console.log(formatInfo(
      releasePage.pagination.totalItems === 0
        ? 'No bundles found for the selected platform, channel, and runtimeVersion.'
        : `No bundles found on page ${releasePage.pagination.page} for the selected platform, channel, and runtimeVersion.`,
    ))
    return
  }

  if (!explicitTargetBundleId) {
    console.log(formatReleasePaginationSummary(releasePage.pagination))
  }

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
  console.log(formatHeading('Bundle selected'))
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
  console.log('')
  printSuccess('Rollback done')
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

  printSuccess(action === 'pause' ? 'Rollout paused' : 'Rollout resumed')
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

async function loadActiveRelease(input: Parameters<typeof listReleases>[0]) {
  let page = 1

  while (true) {
    const releasePage = await listReleases({
      ...input,
      page,
      pageSize: 100,
    })
    const active = releasePage.items.find(item => item.isActive)

    if (active) {
      return active
    }

    if (!releasePage.pagination.hasNextPage) {
      return null
    }

    page += 1
  }
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
  const active = await loadActiveRelease({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
  })

  if (!active) {
    console.log(formatInfo('No active bundle found for the selected platform, channel, and runtimeVersion.'))
    return
  }

  console.log(formatHeading('Active bundle'))
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

export async function handleChannelsList(
  options: Record<string, string | boolean>,
  dependencies: ChannelsListDependencies = {},
) {
  const { api } = await resolveReleaseProjectAccess(options)
  const appId = await resolveChannelsAppId({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    options,
    ...dependencies,
  })
  const channels = await listReleaseChannels({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId,
  })

  printChannelsTable(channels)
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
  const releasePage = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel,
    runtimeVersion,
    ...resolveReleasePaginationOptions(options),
  })

  printBundlesTable(releasePage.items)
  console.log(formatReleasePaginationSummary(releasePage.pagination))
}
