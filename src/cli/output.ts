import type { BundleIdSource } from '../bundle'
import type { BundleIngestItem, ReleaseContext, ReleaseItem } from '../http'

// -----------------------------------------------------------------------------
// Generic output
// -----------------------------------------------------------------------------

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

export function formatBundleIdSource(source: BundleIdSource) {
  switch (source) {
    case 'flag':
      return 'Using bundle ID from --bundle-id.'
    case 'prompt':
      return 'Using bundle ID from prompt.'
    case 'native-version':
      return 'Using bundle ID from nativeVersion with a hash suffix.'
    case 'package-json':
      return 'Using bundle ID from package.json version.'
    default:
      return 'Using fallback bundle ID.'
  }
}

function formatReleaseContextEntity(name: string, slug: string) {
  if (name && name !== slug) {
    return `${name} (${slug})`
  }

  return slug
}

export function formatReleaseContextSummary(context: ReleaseContext) {
  return [
    `Organization: ${formatReleaseContextEntity(context.organizationName, context.organizationSlug)}`,
    `Project: ${formatReleaseContextEntity(context.projectName, context.projectSlug)}`,
  ].join('\n')
}

export function printHelp(version: string, options: { includeNotes?: boolean } = {}) {
  const commands = [
    ['help', '', 'Show help.'],
    ['version', '', 'Show CLI version.'],
    ['login', '[--api-key ...] [--api-url ...]', 'Save project CI key auth locally.'],
    ['init', '[--app-id ...]', 'Select and link this repo to an active app.'],
    ['doctor', '[--api-key ...] [--api-url ...]', 'Check API connectivity and CI key context.'],
    ['keygen', '[--kind ci|ota]', 'Generate an Otalan key locally without calling the API.'],
    ['bundle', '[--target capacitor|expo] [--platform ios|android]', 'Build bundle.zip and manifest.json for Capacitor or Expo apps.'],
    ['', '[--input-dir path] [--output-dir .otalan/bundle]', ''],
    ['', '[--bundle-from-package] [--bundle-id 1.0.5]', ''],
    ['', '[--native-version 1.0.0] [--runtime-version 1.0.0] [--channel production]', ''],
    ['publish', '[--output-dir .otalan/bundle] [--channel production]', 'Publish the current bundle ZIP with rollout metadata.'],
    ['', '[--release-notes "..."] [--optional] [--rollout-percent 100]', ''],
    ['bundles', '[--platform ios|android]', 'List published bundles for a release tuple.'],
    ['', '[--channel production] [--native-version 1.0.0]', ''],
    ['rollback', '--bundle-id ... [--platform ios|android]', 'Reactivate a published bundle.'],
    ['', '[--channel production] [--native-version 1.0.0]', ''],
    ['pause', '[--platform ios|android] [--channel production]', 'Pause the active bundle rollout.'],
    ['', '[--native-version 1.0.0]', ''],
    ['resume', '[--platform ios|android] [--channel production]', 'Resume the active bundle rollout.'],
    ['', '[--native-version 1.0.0]', ''],
    ['status', '[--platform ios|android] [--channel production]', 'Show the active bundle for a release tuple.'],
    ['', '[--native-version 1.0.0]', ''],
  ] as const
  const notes = [
    'Official app support: Capacitor 7/8 and Expo SDK 54/55.',
    'Capacitor packages prebuilt web assets from dist/ or www/ by default; use --input-dir for another folder.',
    'Expo runs `bunx expo export` into .otalan/expo-export-*; no dist/ or www/ build is required first.',
    'Expo runtimeVersion comes from --runtime-version, Expo config/export metadata, or the native version fallback.',
    'Run `otalan login` to authenticate to a project; `otalan init` selects an active app in that project.',
    'Otalan validates release ZIPs before `otalan publish` succeeds.',
    'Release commands require the configured app to be active, not archived.',
  ] as const
  const commandWidth = 12
  const includeNotes = options.includeNotes ?? true

  console.log(`Otalan CLI ${version}`)
  console.log('')
  console.log('Usage: otalan <command> [options]')
  console.log('')
  console.log('Commands:')

  commands.forEach(([command, args, description], index) => {
    if (command && index > 0) {
      console.log('')
    }

    const left = command
      ? `  ${command.padEnd(commandWidth, ' ')} ${args}`.trimEnd()
      : `  ${''.padEnd(commandWidth, ' ')} ${args}`.trimEnd()

    if (description) {
      console.log(`${left.padEnd(78, ' ')} ${description}`)
    } else {
      console.log(left)
    }
  })

  if (includeNotes) {
    console.log('')
    console.log('Notes:')

    for (const note of notes) {
      console.log(`  ${note}`)
    }
  }

  console.log('')
  console.log('Run `otalan <command> --help` to show this help text.')
}

// -----------------------------------------------------------------------------
// Release summaries
// -----------------------------------------------------------------------------

export function formatBundleSummary(input: {
  bundleId: string
  platform: string
  channel: string
  nativeVersion: string
  rolloutPercent?: number
  rolloutState?: string
  releaseNotes?: string | null
  publishedAt?: string
  selectable?: boolean
}) {
  const lines = [
    `Bundle ID: ${input.bundleId}`,
    `Platform: ${input.platform}`,
    `Channel: ${input.channel}`,
    `Native version: ${input.nativeVersion}`,
  ]

  if (input.rolloutPercent !== undefined) {
    lines.push(`Rollout: ${input.rolloutPercent}%`)
  }

  if (input.rolloutState) {
    lines.push(`State: ${input.rolloutState}`)
  }

  if (input.publishedAt) {
    lines.push(`Published at: ${input.publishedAt}`)
  }

  if (input.selectable !== undefined) {
    lines.push(`Selectable: ${input.selectable ? 'yes' : 'no'}`)
  }

  if (input.releaseNotes) {
    lines.push(`Release notes: ${input.releaseNotes}`)
  }

  return lines.join('\n')
}

export function formatPublishSummary(input: {
  bundleId: string
  platform: string
  channel: string
  nativeVersion: string
  rolloutPercent: number
  mandatory: boolean
  releaseNotes?: string
}) {
  const lines = [
    `Bundle ID: ${input.bundleId}`,
    `Platform: ${input.platform}`,
    `Channel: ${input.channel}`,
    `Native version: ${input.nativeVersion}`,
    `Rollout: ${input.rolloutPercent}%`,
    `Mandatory: ${input.mandatory ? 'yes' : 'no'}`,
  ]

  if (input.releaseNotes) {
    lines.push(`Release notes: ${input.releaseNotes}`)
  }

  return lines.join('\n')
}

export function formatIngestSummary(input: {
  ingest: BundleIngestItem
}) {
  const lines = [
    `Ingest ID: ${input.ingest.id}`,
    `Status: ${input.ingest.status}`,
    `Size: ${input.ingest.fileSizeBytes} bytes`,
    `Queued at: ${input.ingest.createdAt}`,
  ]

  if (input.ingest.processedAt) {
    lines.push(`Processed at: ${input.ingest.processedAt}`)
  }

  if (input.ingest.checksum) {
    lines.push(`Checksum: ${input.ingest.checksum}`)
  }

  if (input.ingest.failureReason) {
    lines.push(`Failure reason: ${input.ingest.failureReason}`)
  }

  return lines.join('\n')
}

function formatCell(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ')
}

// -----------------------------------------------------------------------------
// Tables
// -----------------------------------------------------------------------------

export function printBundlesTable(items: ReleaseItem[]) {
  const rows = items.map(item => [
    item.isActive ? 'yes' : 'no',
    item.resolvedDownloadUrl ? 'yes' : 'no',
    item.resolvedDownloadUrl ? 'available' : 'deleted',
    item.bundleId,
    item.nativeVersion,
    item.platform,
    item.channel,
    `${item.rolloutPercent}%`,
    item.rolloutState,
    item.publishedAt.slice(0, 19).replace('T', ' '),
  ])
  const headers = ['active', 'selectable', 'archive', 'bundleId', 'nativeVersion', 'platform', 'channel', 'rollout', 'state', 'publishedAt']
  const widths = headers.map((header, index) =>
    Math.min(
      32,
      Math.max(header.length, ...rows.map(row => row[index]?.length ?? 0)),
    ),
  )

  console.log(headers.map((header, index) => formatCell(header, widths[index])).join('  '))
  console.log(widths.map(width => ''.padEnd(width, '-')).join('  '))

  for (const row of rows) {
    console.log(row.map((cell, index) => formatCell(cell, widths[index])).join('  '))
  }

  if (items.some(item => !item.resolvedDownloadUrl)) {
    console.log('')
    console.log('Rows with archive "deleted" are shown for history, but they are not selectable for rollback.')
  }
}
