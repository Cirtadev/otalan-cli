import path from 'node:path'
import { stdin, stdout } from 'node:process'

import type { BundleManifest } from '../bundle'
import { resolveProjectRuntimeVersion } from '../bundle'
import { readBooleanOption, readStringOption } from '../cli/args'
import {
  assertReleaseContextMatchesConfig,
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
  formatReleaseContextSummary,
} from '../cli/output'
import { promptSelectWithHint, promptWithHint, type PromptSelectWithHintInput } from '../cli/prompts'
import { colorize, formatInfo, formatSuccess } from '../cli/ui'
import type { MobilePlatform } from '../config'
import {
  type BundleIngestItem,
  type ReleaseItem,
  type ReleasePaginationMeta,
  type ReleaseAppItem,
  listReleaseApps,
} from '../http'

export const PLATFORM_OPTIONS = [
  { label: 'ios', value: 'ios' },
  { label: 'android', value: 'android' },
] as const satisfies ReadonlyArray<{ label: string, value: MobilePlatform }>

const INGEST_POLL_INTERVAL_MS = 2_000
const INGEST_WAIT_TIMEOUT_MS = 10 * 60_000
const ALL_CHANNEL_APPS_OPTION = '__all__'
const MAX_RELEASE_PAGE_SIZE = 100

type ChannelAppSelector = (input: {
  question: string
  hint: string
  fallback: string
  options: Array<{ label: string, value: string }>
}) => Promise<string>
type RollbackTargetBundleSelector = (input: PromptSelectWithHintInput<string>) => Promise<string>

export type ChannelsListDependencies = {
  isInteractive?: () => boolean
  loadApps?: (input: { apiUrl: string, apiKey: string }) => Promise<ReleaseAppItem[]>
  selectAppId?: ChannelAppSelector
}

export async function resolveReleaseAccess(
  context: CommandContext,
  options: Record<string, string | boolean>,
  output: { printSummary?: boolean } = {},
) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)
  const releaseContext = await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })

  if (output.printSummary ?? true) {
    for (const line of formatReleaseContextSummary(releaseContext, {
      name: project.appName,
      appId: project.appId,
    }).split('\n')) {
      console.log(line)
    }

    console.log('')
  }

  return {
    api,
    project,
  }
}

export async function resolveReleaseProjectAccess(options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const releaseContext = await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
  })

  for (const line of formatReleaseContextSummary(releaseContext).split('\n')) {
    console.log(line)
  }

  console.log('')

  return {
    api,
  }
}

export function formatReleaseAppOption(app: ReleaseAppItem) {
  return app.name === app.appId ? app.appId : `${app.name} (${app.appId})`
}

export function isInteractiveTerminal() {
  return Boolean(stdin.isTTY && stdout.isTTY)
}

export async function resolveChannelsAppId(input: {
  apiUrl: string
  apiKey: string
  options: Record<string, string | boolean>
} & ChannelsListDependencies) {
  const explicitAppId = readStringOption(input.options, 'app-id')

  if (explicitAppId) {
    return explicitAppId
  }

  const isInteractive = input.isInteractive ?? isInteractiveTerminal

  if (!isInteractive()) {
    return undefined
  }

  const loadApps = input.loadApps ?? listReleaseApps
  const selectAppId = input.selectAppId ?? promptSelectWithHint
  const apps = await loadApps({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
  })
  const selectedAppId = await selectAppId({
    question: 'App',
    fallback: ALL_CHANNEL_APPS_OPTION,
    hint: 'Filter channels by app, or keep All to show every project channel.',
    options: [
      {
        label: 'All',
        value: ALL_CHANNEL_APPS_OPTION,
      },
      ...apps.map(app => ({
        label: formatReleaseAppOption(app),
        value: app.appId,
      })),
    ],
  })

  return selectedAppId === ALL_CHANNEL_APPS_OPTION ? undefined : selectedAppId
}

export function resolveOutputDir(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  return path.resolve(
    context.cwd,
    readStringOption(options, 'output-dir') ?? '.otalan/bundle',
  )
}

export async function resolveDefaultRuntimeVersion(
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

export function resolveRolloutPercent(options: Record<string, string | boolean>) {
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

export function isVerboseOutput(options: Record<string, string | boolean>) {
  return readBooleanOption(options, 'verbose', false, ['v'])
}

function readIntegerOption(
  options: Record<string, string | boolean>,
  key: string,
) {
  const value = readStringOption(options, key)

  if (value === undefined) {
    return undefined
  }

  const numberValue = Number(value)

  if (!Number.isInteger(numberValue)) {
    return Number.NaN
  }

  return numberValue
}

export function resolveReleasePaginationOptions(options: Record<string, string | boolean>) {
  const page = readIntegerOption(options, 'page')
  const pageSize = readIntegerOption(options, 'page-size')

  if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
    throw new Error('page must be an integer greater than or equal to 1.')
  }

  if (
    pageSize !== undefined
    && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_RELEASE_PAGE_SIZE)
  ) {
    throw new Error(`page-size must be an integer between 1 and ${MAX_RELEASE_PAGE_SIZE}.`)
  }

  return {
    page,
    pageSize,
  }
}

export function formatReleasePaginationSummary(pagination: ReleasePaginationMeta) {
  const pageSize = Math.max(1, pagination.pageSize)
  const startItem = ((pagination.page - 1) * pageSize) + 1
  const hasItemsOnPage = pagination.totalItems > 0 && startItem <= pagination.totalItems
  const endItem = hasItemsOnPage
    ? Math.min(pagination.totalItems, pagination.page * pageSize)
    : 0
  const itemSummary = pagination.totalItems === 0
    ? '0 of 0'
    : hasItemsOnPage
      ? `${startItem}-${endItem} of ${pagination.totalItems}`
      : `no items on this page; ${pagination.totalItems} total`
  const pageAction = pagination.hasNextPage
    ? `Use --page ${pagination.page + 1} for the next page.`
    : pagination.hasPreviousPage
      ? `Use --page ${pagination.page - 1} for the previous page.`
      : undefined

  return formatInfo([
    `Page ${pagination.page} of ${pagination.totalPages} (${itemSummary}).`,
    pageAction,
  ].filter(Boolean).join(' '))
}

export function formatPublishSuccessMessage() {
  return formatSuccess(`Release is ${colorize('Live', 'green')}`)
}

async function promptPlatformChoice() {
  return promptSelectWithHint({
    question: 'Platform',
    hint: 'Target mobile platform: ios or android.',
    options: PLATFORM_OPTIONS,
  })
}

export async function resolveReleaseTupleFromManifest(
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

export async function resolveRemoteReleaseTuple(
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

export function resolveManifestExpoPublishMetadata(manifest: BundleManifest) {
  if (manifest.target !== 'expo') {
    return undefined
  }

  return JSON.stringify(manifest)
}

export function isTerminalIngestStatus(status: string) {
  return status === 'ready' || status === 'failed'
}

export async function resolveRollbackTargetBundleId(input: {
  options: Record<string, string | boolean>
  releases: ReleaseItem[]
  selectTargetBundleId?: RollbackTargetBundleSelector
}) {
  const targetBundleId = readStringOption(input.options, 'bundle-id')
    ?? readStringOption(input.options, 'target-bundle-id')

  if (targetBundleId) {
    return targetBundleId
  }

  const selectableRelease = input.releases.find(item => item.resolvedDownloadUrl && !item.isActive)

  if (!selectableRelease) {
    throw new Error('No previous rollback bundle archives are available for the selected platform, channel, and runtimeVersion.')
  }

  const selectTargetBundleId = input.selectTargetBundleId ?? promptSelectWithHint

  return selectTargetBundleId({
    question: 'Bundle to reactivate',
    fallback: selectableRelease.bundleId,
    hint: 'Select a previous bundle with an available archive. The current live bundle and deleted archives are disabled.',
    options: input.releases.map(formatRollbackBundleOption),
  })
}

function formatRollbackBundleOption(item: ReleaseItem) {
  const isSelectable = Boolean(item.resolvedDownloadUrl && !item.isActive)
  const status = formatRollbackBundleStatus(item)
  const label = [
    item.bundleId,
    status,
    `${item.rolloutPercent}%`,
    item.publishedAt.slice(0, 19).replace('T', ' '),
  ].join(' | ')
  const option = {
    label: item.isActive ? colorize(label, 'green') : label,
    value: item.bundleId,
    hint: [
      `${item.platform}/${item.channel}`,
      `runtime ${item.runtimeVersion}`,
      item.mandatory ? 'mandatory' : 'optional',
      formatRollbackBundleHintStatus(item),
    ].join(', '),
  }

  return isSelectable
    ? option
    : {
      ...option,
      disabled: true,
    }
}

function formatRollbackBundleStatus(item: ReleaseItem) {
  if (item.isActive) {
    return 'Current Live'
  }

  return item.resolvedDownloadUrl ? 'Rollback target' : 'Archive unavailable'
}

function formatRollbackBundleHintStatus(item: ReleaseItem) {
  if (item.isActive) {
    return 'current live bundle'
  }

  return item.resolvedDownloadUrl ? 'available rollback target' : 'archive unavailable'
}

export async function waitForReleaseIngest(input: {
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
