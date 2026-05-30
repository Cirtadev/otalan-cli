import type { BundleIdSource } from '../bundle'
import type { ProjectConfig } from '../config'
import type { BundleIngestItem, ReleaseChannelAppItem, ReleaseChannelItem, ReleaseContext, ReleaseItem } from '../http'
import { formatKeyValueTable, printTable } from './table'
import {
  formatHeading,
  formatMuted,
  formatWarning,
  styleText,
} from './ui'

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

export function formatBundleIdSource(source: BundleIdSource) {
  switch (source) {
    case 'flag':
      return 'Using bundle ID from --bundle-id.'
    case 'prompt':
      return 'Using bundle ID from prompt.'
    case 'runtime-version':
      return 'Using bundle ID from runtimeVersion with a hash suffix.'
    case 'package-json':
      return 'Using bundle ID from package.json version.'
    default:
      return 'Using fallback bundle ID.'
  }
}

function formatContextEntity(name: string | undefined, identifier: string | undefined) {
  if (name && identifier && name !== identifier) {
    return `${name} (${identifier})`
  }

  return name ?? identifier ?? 'unknown'
}

export function formatProjectConfigSummary(config: ProjectConfig) {
  return formatKeyValueTable([
    ['Organization', config.organizationSlug],
    ['Project', config.projectSlug],
    ['App', formatContextEntity(config.appName, config.appId)],
  ])
}

export function formatReleaseContextSummary(
  context: ReleaseContext,
  app?: { name?: string, appId: string },
) {
  return formatKeyValueTable([
    ['Organization', formatContextEntity(context.organizationName, context.organizationSlug)],
    ['Project', formatContextEntity(context.projectName, context.projectSlug)],
    ['App', app ? formatContextEntity(app.name, app.appId) : undefined],
  ])
}

export function printHelp(version: string, options: { includeNotes?: boolean } = {}) {
  const commands = [
    ['help', '', 'Show help.'],
    ['version', '', 'Show CLI version.'],
    ['login', '[--api-key ...] [--api-url ...]', 'Save project OTA Publish Key auth locally.'],
    ['init', '[--app-id ...]', 'Select and link this repo to an active app.'],
    ['doctor', '[--api-key ...] [--api-url ...]', 'Check API connectivity and OTA Publish Key context.'],
    ['keygen', '[--kind ci|ota]', 'Generate an Otalan key locally without calling the API.'],
    ['bundle', '[--target capacitor|expo] [--platform ios|android]', 'Build bundle-<bundle-id>.zip and manifest.json for Capacitor or Expo apps.'],
    ['', '[--input-dir path] [--output-dir .otalan/bundle]', ''],
    ['', '[--bundle-from-package] [--bundle-id 1.0.5]', ''],
    ['', '[--runtime-version 1.0.0] [--channel production] [--verbose|-v]', ''],
    ['publish', '[--output-dir .otalan/bundle] [--channel production]', 'Publish the current bundle ZIP with rollout metadata.'],
    ['', '[--release-notes "..."] [--optional] [--rollout-percent 100] [--verbose|-v]', ''],
    ['channels', '[--app-id com.example.app]', 'List release channels for the authenticated project.'],
    ['bundles', '[--platform ios|android]', 'List published bundles for a release tuple.'],
    ['', '[--channel production] [--runtime-version 1.0.0]', ''],
    ['rollback', '--bundle-id ... [--platform ios|android]', 'Reactivate a published bundle.'],
    ['', '[--channel production] [--runtime-version 1.0.0]', ''],
    ['pause', '[--platform ios|android] [--channel production]', 'Pause the active bundle rollout.'],
    ['', '[--runtime-version 1.0.0]', ''],
    ['resume', '[--platform ios|android] [--channel production]', 'Resume the active bundle rollout.'],
    ['', '[--runtime-version 1.0.0]', ''],
    ['status', '[--platform ios|android] [--channel production]', 'Show the active bundle for a release tuple.'],
    ['', '[--runtime-version 1.0.0]', ''],
  ] as const
  const notes = [
    'Official app support: Capacitor 7/8 and Expo SDK 54/55/56.',
    'Run `otalan login` to authenticate to a project; `otalan init` selects an active app in that project.',
    'Otalan validates release ZIPs before `otalan publish` succeeds.',
    'App-scoped release commands require the configured app to be active, not archived.',
  ] as const
  const commandWidth = 12
  const includeNotes = options.includeNotes ?? true

  console.log(formatHeading(`Otalan CLI ${version}`))
  console.log('')
  console.log(`${formatHeading('Usage:')} ${styleText('otalan <command> [options]', 'bold')}`)
  console.log('')
  console.log(formatHeading('Commands:'))

  commands.forEach(([command, args, description], index) => {
    if (command && index > 0) {
      console.log('')
    }

    const rawLeft = command
      ? `  ${command.padEnd(commandWidth, ' ')} ${args}`.trimEnd()
      : `  ${''.padEnd(commandWidth, ' ')} ${args}`.trimEnd()
    const left = command
      ? `  ${styleText(command.padEnd(commandWidth, ' '), 'cyan')} ${formatMuted(args)}`.trimEnd()
      : rawLeft

    if (description) {
      console.log(`${left}${''.padEnd(Math.max(1, 78 - rawLeft.length), ' ')} ${description}`)
    } else {
      console.log(left)
    }
  })

  if (includeNotes) {
    console.log('')
    console.log(formatHeading('Notes:'))

    for (const note of notes) {
      console.log(`  ${formatMuted(note)}`)
    }
  }

  console.log('')
  console.log(formatMuted('Run `otalan <command> --help` to show this help text.'))
}

export function formatBundleSummary(input: {
  bundleId: string
  platform: string
  channel: string
  runtimeVersion: string
  rolloutPercent?: number
  rolloutState?: string
  releaseNotes?: string | null
  publishedAt?: string
  selectable?: boolean
}) {
  return formatKeyValueTable([
    ['Bundle ID', input.bundleId],
    ['Platform', input.platform],
    ['Channel', input.channel],
    ['Runtime version', input.runtimeVersion],
    ['Rollout', input.rolloutPercent === undefined ? undefined : `${input.rolloutPercent}%`],
    ['State', input.rolloutState],
    ['Published at', input.publishedAt],
    ['Selectable', input.selectable === undefined ? undefined : input.selectable ? 'yes' : 'no'],
    ['Release notes', input.releaseNotes],
  ])
}

export function formatPublishSummary(input: {
  app?: string
  archiveFileName?: string
  archiveSizeBytes?: number
  bundleId: string
  platform: string
  channel: string
  runtimeVersion: string
  rolloutPercent: number
  mandatory: boolean
  releaseNotes?: string
  target?: string
}) {
  return formatKeyValueTable([
    ['App', input.app],
    ['Target', input.target],
    ['Bundle ID', input.bundleId],
    ['Platform', input.platform],
    ['Channel', input.channel],
    ['Runtime version', input.runtimeVersion],
    ['Rollout', `${input.rolloutPercent}%`],
    ['Mandatory', input.mandatory ? 'yes' : 'no'],
    ['Archive', formatArchiveValue(input.archiveFileName, input.archiveSizeBytes)],
    ['Release notes', input.releaseNotes],
  ])
}

export function formatPublishedReleaseSummary(input: {
  app: string
  archiveFileName: string
  archiveSizeBytes: number
  ingest: BundleIngestItem
  releaseNotes?: string
  target: string
}) {
  return formatKeyValueTable([
    ['App', input.app],
    ['Target', input.target],
    ['Bundle ID', input.ingest.bundleId],
    ['Platform', input.ingest.platform],
    ['Channel', input.ingest.channel],
    ['Runtime version', input.ingest.runtimeVersion],
    ['Rollout', `${input.ingest.rolloutPercent}%`],
    ['Mandatory', input.ingest.mandatory ? 'yes' : 'no'],
    ['Archive', formatArchiveValue(input.archiveFileName, input.archiveSizeBytes)],
    ['Ingest ID', input.ingest.id],
    ['Status', input.ingest.status],
    ['Processed at', input.ingest.processedAt],
    ['Checksum', formatChecksum(input.ingest.checksum)],
    ['Release notes', input.releaseNotes ?? input.ingest.releaseNotes],
  ])
}

function formatArchiveValue(fileName?: string, fileSizeBytes?: number) {
  if (!fileName) {
    return undefined
  }

  if (fileSizeBytes === undefined) {
    return fileName
  }

  return `${fileName} (${fileSizeBytes} bytes)`
}

function formatChecksum(checksum: string | null) {
  if (!checksum || checksum.length <= 24) {
    return checksum
  }

  return `${checksum.slice(0, 12)}...${checksum.slice(-8)}`
}

export function formatIngestSummary(input: {
  ingest: BundleIngestItem
}) {
  return formatKeyValueTable([
    ['Ingest ID', input.ingest.id],
    ['Status', input.ingest.status],
    ['Size', `${input.ingest.fileSizeBytes} bytes`],
    ['Queued at', input.ingest.createdAt],
    ['Processed at', input.ingest.processedAt],
    ['Checksum', input.ingest.checksum],
    ['Failure reason', input.ingest.failureReason],
  ])
}

export function printBundlesTable(items: ReleaseItem[]) {
  printTable({
    columns: [
      { header: 'active', maxWidth: 6 },
      { header: 'select', maxWidth: 6 },
      { header: 'archive', maxWidth: 9 },
      { header: 'bundleId', maxWidth: 32 },
      { header: 'runtime', maxWidth: 18 },
      { header: 'platform', maxWidth: 8 },
      { header: 'channel', maxWidth: 18 },
      { align: 'right', header: 'rollout', maxWidth: 7 },
      { header: 'state', maxWidth: 12 },
      { header: 'publishedAt', maxWidth: 19 },
    ],
    emptyMessage: 'No bundles found.',
    rows: items.map(item => ({
      cells: [
        item.isActive ? 'yes' : 'no',
        item.resolvedDownloadUrl ? 'yes' : 'no',
        item.resolvedDownloadUrl ? 'available' : 'deleted',
        item.bundleId,
        item.runtimeVersion,
        item.platform,
        item.channel,
        `${item.rolloutPercent}%`,
        item.rolloutState,
        item.publishedAt.slice(0, 19).replace('T', ' '),
      ],
      tone: item.isActive ? 'success' as const : item.resolvedDownloadUrl ? undefined : 'muted' as const,
    })),
  })

  if (items.some(item => !item.resolvedDownloadUrl)) {
    console.log('')
    console.log(formatWarning('Rows with archive "deleted" are shown for history, but they are not selectable for rollback.'))
  }
}

function formatChannelApp(app: ReleaseChannelAppItem) {
  return app.name === app.appId ? app.appId : `${app.name} (${app.appId})`
}

export function printChannelsTable(channels: ReleaseChannelItem[]) {
  printTable({
    columns: [
      { header: 'channel', maxWidth: 24 },
      { header: 'apps', maxWidth: 120 },
    ],
    emptyMessage: 'No channels found.',
    rows: channels.map(item => ({
      cells: [
        item.channel,
        item.apps.map(formatChannelApp).join(', '),
      ],
    })),
  })
}
