#!/usr/bin/env bun

import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import {
  PROJECT_CONFIG_FILE,
  loadGlobalConfig,
  loadProjectConfig,
  saveGlobalConfig,
  saveProjectConfig,
  type MobilePlatform,
  type Target,
} from './config'
import { bundleProject, type BundleIdSource, type BundleManifest } from './bundle'
import {
  createRelease,
  getReleaseContext,
  listReleases,
  publishRelease,
  rollbackRelease,
} from './http'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type ParsedArgs = {
  command?: string
  subcommand?: string
  options: Record<string, string | boolean>
}

type CommandContext = {
  cwd: string
}

// -----------------------------------------------------------------------------
// CLI helpers
// -----------------------------------------------------------------------------

function parseArgs(argv: string[]): ParsedArgs {
  const [command, maybeSubcommand, ...restWithMaybeSubcommand] = argv
  const hasSubcommand = command === 'bundles'
  const subcommand = hasSubcommand ? maybeSubcommand : undefined
  const rest = hasSubcommand ? restWithMaybeSubcommand : [maybeSubcommand, ...restWithMaybeSubcommand].filter(Boolean) as string[]
  const options: Record<string, string | boolean> = {}

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]

    if (!token.startsWith('-')) {
      continue
    }

    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = rest[index + 1]

      if (!next || next.startsWith('-')) {
        options[key] = true
        continue
      }

      options[key] = next
      index += 1
      continue
    }

    if (token.length > 2) {
      for (const flag of token.slice(1)) {
        options[flag] = true
      }

      continue
    }

    const key = token.slice(1)
    options[key] = true
  }

  return { command, subcommand, options }
}

function readStringOption(options: Record<string, string | boolean>, key: string) {
  const value = options[key]
  return typeof value === 'string' ? value : undefined
}

function readBooleanOption(options: Record<string, string | boolean>, key: string, fallback = false) {
  const value = options[key]

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value === 'true'
  }

  return fallback
}

async function prompt(question: string, fallback?: string) {
  const rl = readline.createInterface({ input, output })

  try {
    const message = fallback ? `${question} (${fallback}): ` : `${question}: `
    const answer = (await rl.question(message)).trim()
    return answer || fallback || ''
  } finally {
    rl.close()
  }
}

type PromptWithHintInput = {
  question: string
  hint: string
  example?: string
  fallback?: string
}

async function promptWithHint(input: PromptWithHintInput) {
  console.log('')
  console.log(input.hint)

  if (input.example) {
    console.log(`Example: ${input.example}`)
  }

  return prompt(input.question, input.fallback)
}

async function promptOptionalWithHint(input: PromptWithHintInput & {
  optional?: boolean
}) {
  console.log('')
  console.log(input.hint)

  if (input.example) {
    console.log(`Example: ${input.example}`)
  }

  const value = await prompt(input.question, input.fallback)
  return value.length > 0 ? value : undefined
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

function formatBundleIdSource(source: BundleIdSource) {
  switch (source) {
    case 'flag':
      return 'Using bundle ID from --bundle-id.'
    case 'native-version':
      return 'Using bundle ID from nativeVersion with an automatic hash suffix.'
    case 'package-json':
      return 'Using bundle ID from package.json version.'
    default:
      return 'Using fallback bundle ID 0.0.0.'
  }
}

function printHelp() {
  const commands = [
    ['help', '', 'Print help text.'],
    ['login', '[--api-key ...] [--api-url ...]', 'Save the CI key and API base URL locally.'],
    ['init', '[--app-id ...] [--target capacitor|expo]', 'Create otalan.config.json for the current app and auto-resolve CI key context when available.'],
    ['', '[--channel production] [--platform ios|android] [--native-version 1.0.0]', ''],
    ['bundle', '[--target capacitor|expo] [--input-dir dist]', 'Build bundle.zip and manifest.json. Default bundle ID uses nativeVersion with a hash suffix.'],
    ['', '[--output-dir .otalan/bundle] [--bundle-id 1.0.5] [--bundle-from-package] [--native-version 1.0.0]', ''],
    ['publish', '[--output-dir .otalan/bundle] [--platform ios|android]', 'Upload and publish the current bundle output.'],
    ['', '[--channel production] [--release-notes "..."]', ''],
    ['bundles', '[--platform ios|android] [--channel production]', 'List remote bundles for rollout and rollback selection.'],
    ['', '[--native-version 1.0.0]', ''],
    ['rollback', '--bundle-id ... [--platform ios|android] [--channel production]', 'Reactivate a previously published bundle.'],
    ['status', '[--platform ios|android] [--channel production]', 'Show the active bundle and matching remote history.'],
  ] as const
  const notes = [
    'CLI commands use the CI key.',
    'Get CI keys from https://otalan.com/api-keys.',
    'Build your app before `otalan bundle` for Capacitor projects.',
    'Run `otalan login` before publish, rollback, status, or bundles.',
  ] as const
  const commandWidth = 12

  console.log('Otalan CLI')
  console.log('')
  console.log('Usage: otalan <command> [options]')
  console.log('')
  console.log('Commands:')

  for (const [command, args, description] of commands) {
    const left = command
      ? `  ${command.padEnd(commandWidth, ' ')} ${args}`.trimEnd()
      : `  ${''.padEnd(commandWidth, ' ')} ${args}`.trimEnd()

    if (description) {
      console.log(`${left.padEnd(78, ' ')} ${description}`)
    } else {
      console.log(left)
    }
  }

  console.log('')
  console.log('Notes:')

  for (const note of notes) {
    console.log(`  ${note}`)
  }

  console.log('')
  console.log('Run `otalan <command> --help` to print this help text.')
}

function resolveApiKeysUrl(apiUrl: string) {
  try {
    const parsed = new URL(apiUrl)

    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return 'http://localhost:4000/api-keys'
    }
  } catch {
    return 'https://otalan.com/api-keys'
  }

  return 'https://otalan.com/api-keys'
}

async function resolveApiConfig(options: Record<string, string | boolean>) {
  const stored = await loadGlobalConfig().catch(() => null)
  const apiKey = readStringOption(options, 'api-key') ?? stored?.apiKey
  const apiUrl = readStringOption(options, 'api-url') ?? stored?.apiUrl ?? 'https://api.otalan.com'

  if (!apiKey) {
    throw new Error('No API key configured. Run `otalan login` first or pass --api-key.')
  }

  return {
    apiKey,
    apiUrl,
  }
}

async function assertReleaseContextMatchesConfig(input: {
  apiUrl: string
  apiKey: string
  organizationSlug?: string
  projectSlug?: string
}) {
  if (!input.organizationSlug && !input.projectSlug) {
    return null
  }

  const context = await getReleaseContext({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
  })

  if (input.organizationSlug && input.organizationSlug !== context.organizationSlug) {
    throw new Error(
      `Configured organization slug "${input.organizationSlug}" does not match CI key organization "${context.organizationSlug}".`,
    )
  }

  if (input.projectSlug && input.projectSlug !== context.projectSlug) {
    throw new Error(
      `Configured project slug "${input.projectSlug}" does not match CI key project "${context.projectSlug}".`,
    )
  }

  return context
}

async function resolveProject(context: CommandContext) {
  return loadProjectConfig(context.cwd).catch(() => {
    throw new Error(`Missing ${PROJECT_CONFIG_FILE}. Run \`otalan init\` in this project first.`)
  })
}

function resolveTarget(
  options: Record<string, string | boolean>,
  fallback?: Target,
): Target {
  const target = readStringOption(options, 'target') ?? fallback

  if (target === 'capacitor' || target === 'expo') {
    return target
  }

  throw new Error('Target is required. Use --target capacitor or --target expo.')
}

function resolvePlatform(
  options: Record<string, string | boolean>,
  fallback?: MobilePlatform,
): MobilePlatform {
  const platform = readStringOption(options, 'platform') ?? fallback

  if (platform === 'ios' || platform === 'android') {
    return platform
  }

  throw new Error('Platform is required for publish, rollback, and status. Use --platform ios or --platform android.')
}

function resolveNativeVersion(_manifest: BundleManifest, fallback?: string) {
  if (!fallback) {
    throw new Error('Native version is required. Set nativeVersion in otalan.config.json or pass --native-version.')
  }

  return fallback
}

async function readBundleManifest(outputDir: string) {
  const raw = JSON.parse(
    await Bun.file(path.join(outputDir, 'manifest.json')).text(),
  ) as BundleManifest

  return raw
}

async function readBundleFile(outputDir: string) {
  const bytes = await Bun.file(path.join(outputDir, 'bundle.zip')).bytes()
  return new File([bytes], 'bundle.zip', { type: 'application/zip' })
}

function formatBundleSummary(input: {
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

function formatPublishSummary(input: {
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

function formatCell(value: string, width: number) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ')
}

function printBundlesTable(items: Awaited<ReturnType<typeof listReleases>>) {
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

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

async function handleLogin(options: Record<string, string | boolean>) {
  const apiUrl = readStringOption(options, 'api-url') ?? await promptWithHint({
    question: 'Otalan API URL',
    fallback: 'https://api.otalan.com',
    hint: 'Backend API base URL. Use https://api.otalan.com for production or http://localhost:8787 for local development.',
  })
  const apiKeysUrl = resolveApiKeysUrl(apiUrl)

  if (!readStringOption(options, 'api-key')) {
    console.log('')
    console.log(`Get your CI key from: ${apiKeysUrl}`)
  }

  const apiKey = readStringOption(options, 'api-key') ?? await promptWithHint({
    question: 'CI key',
    hint: 'Project CI key used by the CLI for publish, rollback, status, and remote bundle listing. Do not use the OTA app key here.',
    example: 'otalan_ci_xxxxxxxxx',
  })

  await saveGlobalConfig({
    apiKey,
    apiUrl,
  })

  const context = await getReleaseContext({
    apiUrl,
    apiKey,
  }).catch(() => null)

  if (context) {
    console.log('')
    console.log(`Resolved CI key context: ${context.organizationSlug} / ${context.projectSlug}`)
  }

  console.log('')
  console.log('Saved CLI auth config.')
}

async function handleInit(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options).catch(() => null)
  const releaseContext = api
    ? await getReleaseContext({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
    }).catch(() => null)
    : null
  const appId = readStringOption(options, 'app-id') ?? await promptWithHint({
    question: 'App ID',
    hint: 'Registered app ID shown under the app name on the Apps page. It is matched inside the project resolved by the CI key.',
    example: 'app.cryptosan.app',
  })
  const target = resolveTarget(options, (await promptWithHint({
    question: 'Target',
    fallback: 'capacitor',
    hint: 'OTA client type. Use capacitor for Capawesome/Capacitor apps or expo for Expo apps.',
  })) as Target)
  const channel = readStringOption(options, 'channel') ?? await promptWithHint({
    question: 'Channel',
    fallback: 'production',
    hint: 'Release channel used when checking or publishing updates.',
  })
  const platform = readStringOption(options, 'platform') ?? await promptOptionalWithHint({
    question: 'Default platform',
    hint: 'Optional default mobile platform for this project config. Leave empty if you want to pass it later per command.',
  })
  const nativeVersion = readStringOption(options, 'native-version')
    ?? readStringOption(options, 'current-version')
    ?? await promptOptionalWithHint({
      question: 'Default native version',
      hint: 'Optional default native app version used by publish, status, and rollback commands.',
    })

  await saveProjectConfig(context.cwd, {
    organizationSlug: releaseContext?.organizationSlug,
    projectSlug: releaseContext?.projectSlug,
    appId,
    target,
    channel,
    platform: platform === 'ios' || platform === 'android' ? platform : undefined,
    nativeVersion,
  })

  if (releaseContext) {
    console.log('')
    console.log(`Resolved CI key context: ${releaseContext.organizationSlug} / ${releaseContext.projectSlug}`)
  }

  console.log(`Created ${PROJECT_CONFIG_FILE}.`)
}

async function handleBundle(context: CommandContext, options: Record<string, string | boolean>) {
  const projectConfig = await loadProjectConfig(context.cwd).catch(() => null)
  const target = resolveTarget(
    options,
    projectConfig?.target ?? await promptWithHint({
      question: 'Target',
      fallback: 'capacitor',
      hint: 'OTA client type to bundle for.',
    }) as Target,
  )
  const outputDir = path.resolve(
    context.cwd,
    readStringOption(options, 'output-dir') ?? '.otalan/bundle',
  )

  if (target === 'capacitor') {
    console.log('')
    console.log('IMPORTANT: Make sure your web assets are already built before running `otalan bundle`.')
    console.log('')
  }

  const result = await bundleProject({
    cwd: context.cwd,
    outputDir,
    inputDir: readStringOption(options, 'input-dir'),
    bundleId: readStringOption(options, 'bundle-id')
      ?? readStringOption(options, 'version')
      ?? readStringOption(options, 'runtime-version'),
    bundleFromPackage: readBooleanOption(options, 'bundle-from-package', false),
    nativeVersion: readStringOption(options, 'native-version') ?? projectConfig?.nativeVersion,
    runtimeVersion: readStringOption(options, 'runtime-version'),
    platform: readStringOption(options, 'platform') as MobilePlatform | undefined,
    projectConfig: projectConfig ?? undefined,
    target,
  })

  console.log(formatBundleIdSource(result.bundleIdSource))
  console.log('')
  printJson(result)
}

async function handlePublish(context: CommandContext, options: Record<string, string | boolean>) {
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
  const platform = resolvePlatform(
    options,
    manifest.platform ?? project.platform ?? await promptWithHint({
      question: 'Platform',
      hint: 'Mobile platform this release targets.',
    }) as MobilePlatform,
  )
  const nativeVersion = resolveNativeVersion(
    manifest,
    readStringOption(options, 'native-version')
      ?? project.nativeVersion
      ?? await promptWithHint({
        question: 'Native version',
        hint: 'Exact native app version this release target, it is the iOS or Android app version.',
      }),
  )
  const channel = readStringOption(options, 'channel') ?? project.channel ?? 'production'
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
    console.log('Succeeded: release published.')
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
  console.log('Succeeded: release published.')
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

async function handleRollback(context: CommandContext, options: Record<string, string | boolean>) {
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
      hint: 'Existing remote bundle ID you want to reactivate.',
      example: '1.0.0-web.1',
    })

  const platform = resolvePlatform(
    options,
    project.platform ?? await promptWithHint({
      question: 'Platform',
      hint: 'Mobile platform this rollback targets.',
    }) as MobilePlatform,
  )
  const nativeVersion = readStringOption(options, 'native-version')
    ?? project.nativeVersion
    ?? await promptWithHint({
      question: 'Native version',
      hint: 'Exact native app version for the bundle tuple you want to roll back.',
    })

  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel: readStringOption(options, 'channel') ?? project.channel ?? 'production',
    nativeVersion,
  })
  const targetRelease = releases.find(item => item.bundleId === targetBundleId)

  if (!nativeVersion) {
    throw new Error('Rollback requires a native version. Set nativeVersion in otalan.config.json or pass --native-version.')
  }

  if (!targetRelease) {
    throw new Error(`Target bundle "${targetBundleId}" was not found for the selected tuple.`)
  }

  if (!targetRelease.resolvedDownloadUrl) {
    throw new Error(`Target bundle "${targetBundleId}" archive is unavailable and cannot be rolled back to.`)
  }

  await rollbackRelease({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform,
    channel: readStringOption(options, 'channel') ?? project.channel ?? 'production',
    nativeVersion,
    targetBundleId,
  })

  console.log('')
  console.log('Succeeded: version selected for rollout.')
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

async function handleStatus(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)
  await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })
  const platform = (readStringOption(options, 'platform') as MobilePlatform | undefined)
    ?? project.platform
    ?? await promptOptionalWithHint({
      question: 'Platform filter',
      hint: 'Optional platform filter for the remote release list.',
    }) as MobilePlatform | undefined
  const nativeVersion = readStringOption(options, 'native-version')
    ?? project.nativeVersion
    ?? await promptOptionalWithHint({
      question: 'Native version filter',
      hint: 'Optional native version filter.',
    })
  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform: platform ?? project.platform,
    channel: readStringOption(options, 'channel') ?? project.channel,
    nativeVersion,
  })

  const active = releases.find(item => item.isActive) ?? null

  if (!active) {
    console.log('No active bundle found for the selected filters.')
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

async function handleBundlesList(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const project = await resolveProject(context)
  await assertReleaseContextMatchesConfig({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    organizationSlug: project.organizationSlug,
    projectSlug: project.projectSlug,
  })
  const releases = await listReleases({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    appId: project.appId,
    platform: (readStringOption(options, 'platform') as MobilePlatform | undefined)
      ?? project.platform
      ?? await promptOptionalWithHint({
        question: 'Platform filter',
        hint: 'Optional platform filter for the remote bundle list.',
      }) as MobilePlatform | undefined,
    channel: readStringOption(options, 'channel') ?? project.channel,
    nativeVersion: readStringOption(options, 'native-version')
      ?? project.nativeVersion
      ?? await promptOptionalWithHint({
        question: 'Native version filter',
        hint: 'Optional native version filter.',
      }),
  })

  printBundlesTable(releases)
}

// -----------------------------------------------------------------------------
// Entrypoint
// -----------------------------------------------------------------------------

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  const context: CommandContext = {
    cwd: process.cwd(),
  }

  if (parsed.options.help === true && parsed.command !== 'login' && parsed.command !== 'init') {
    printHelp()
    return
  }

  switch (parsed.command) {
    case 'login':
      await handleLogin(parsed.options)
      return
    case 'init':
      await handleInit(context, parsed.options)
      return
    case 'bundle':
      await handleBundle(context, parsed.options)
      return
    case 'publish':
      await handlePublish(context, parsed.options)
      return
    case 'rollback':
      await handleRollback(context, parsed.options)
      return
    case 'help':
      printHelp()
      return
    case 'status':
      await handleStatus(context, parsed.options)
      return
    case 'bundles':
      if (!parsed.subcommand || parsed.subcommand === 'ls') {
        await handleBundlesList(context, parsed.options)
        return
      }

      printHelp()
      return
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      return
    default:
      throw new Error(`Unknown command: ${parsed.command}`)
  }
}

;(async () => {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
})()
