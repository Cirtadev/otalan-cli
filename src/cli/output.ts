import type { BundleIdSource } from '../bundle'
import type { BundleIngestItem, ReleaseItem } from '../http'

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
    case 'native-version':
      return 'Using bundle ID from nativeVersion with a hash suffix.'
    case 'package-json':
      return 'Using bundle ID from package.json version.'
    default:
      return 'Using fallback bundle ID.'
  }
}

export function printHelp() {
  const commands = [
    ['help', '', 'Show help.'],
    ['login', '[--api-key ...] [--api-url ...]', 'Save the CI key and API URL locally.'],
    ['init', '[--app-id ...]', 'Create otalan.config.json and link this repo to an app.'],
    ['bundle', '[--target capacitor|expo] [--platform ios|android]', 'Build bundle.zip and manifest.json for Capacitor or Expo/React Native apps.'],
    ['', '[--input-dir dist] [--output-dir .otalan/bundle]', ''],
    ['', '[--bundle-from-package] [--bundle-id 1.0.5]', ''],
    ['', '[--native-version 1.0.0] [--runtime-version 1.0.0]', ''],
    ['publish', '[--output-dir .otalan/bundle] [--channel production]', 'Publish the current bundle ZIP with rollout metadata.'],
    ['', '[--release-notes "..."] [--optional] [--rollout-percent 100]', ''],
    ['bundles', '[--platform ios|android]', 'List published bundles for a release tuple.'],
    ['', '[--channel production] [--native-version 1.0.0]', ''],
    ['rollback', '--bundle-id ... [--platform ios|android]', 'Reactivate a published bundle.'],
    ['', '[--channel production] [--native-version 1.0.0]', ''],
    ['status', '[--platform ios|android] [--channel production]', 'Show the active bundle for a release tuple.'],
    ['', '[--native-version 1.0.0]', ''],
  ] as const
  const notes = [
    'Use a CI key with the CLI.',
    'Get CI keys from https://otalan.com/api-keys.',
    'Build web assets before running `otalan bundle` for Capacitor projects.',
    'Use `--target expo` for Expo and React Native apps that ship OTA updates through Expo export.',
    'Otalan validates release ZIPs before `otalan publish` succeeds.',
    'Run `otalan login` before publish, rollback, status, or bundles.',
  ] as const
  const commandWidth = 12

  console.log('Otalan CLI')
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

  console.log('')
  console.log('Notes:')

  for (const note of notes) {
    console.log(`  ${note}`)
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
  createdAt?: string
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

  if (input.createdAt) {
    lines.push(`Published at: ${input.createdAt}`)
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
    item.createdAt.slice(0, 19).replace('T', ' '),
  ])
  const headers = ['active', 'selectable', 'archive', 'bundleId', 'nativeVersion', 'platform', 'channel', 'rollout', 'state', 'createdAt']
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
