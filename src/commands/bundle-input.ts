import path from 'node:path'
import { stdin, stdout } from 'node:process'

import { resolveProjectRuntimeVersion, type BundleManifest } from '../bundle'
import { readBooleanOption, readStringOption } from '../cli/args'
import {
  assertReleaseContextMatchesConfig,
  resolveApiConfig,
  resolveProject,
  type CommandContext,
} from '../cli/helpers'
import { formatProjectConfigSummary } from '../cli/output'
import { promptWithHint, type PromptWithHintInput } from '../cli/prompts'
import { formatKeyValueTable } from '../cli/table'
import { printWarning } from '../cli/ui'
import type { MobilePlatform, Target } from '../config'
import { listReleases, type ReleaseItem } from '../http'

export const TARGET_OPTIONS = [
  { label: 'capacitor', value: 'capacitor' },
  { label: 'expo', value: 'expo' },
] as const satisfies ReadonlyArray<{ label: string, value: Target }>

export const PLATFORM_OPTIONS = [
  { label: 'ios', value: 'ios' },
  { label: 'android', value: 'android' },
] as const satisfies ReadonlyArray<{ label: string, value: MobilePlatform }>

type TextPrompt = (input: PromptWithHintInput) => Promise<string>

type PublishedBundleHint = {
  channel: string
  bundleId?: string
  checked: boolean
}

type ExistingPublishedBundleCheck = {
  channel: string
  checked: boolean
  unavailableReason?: string
  release?: ReleaseItem
}

export function isInteractiveTerminal() {
  return Boolean(stdin.isTTY && stdout.isTTY)
}

export async function printBundleProjectContext(context: CommandContext) {
  const project = await resolveProject(context).catch(() => null)

  if (!project) {
    return
  }

  for (const line of formatProjectConfigSummary(project).split('\n')) {
    console.log(line)
  }

  console.log('')
}

export function isVerboseOutput(options: Record<string, string | boolean>) {
  return readBooleanOption(options, 'verbose', false, ['v'])
}

export function formatBundleDirectoryHint(input: {
  cwd: string
  outputDir: string
}) {
  const relativeOutputDir = path.relative(input.cwd, input.outputDir)
  const displayPath = relativeOutputDir && !relativeOutputDir.startsWith('..') && !path.isAbsolute(relativeOutputDir)
    ? relativeOutputDir
    : input.outputDir

  return formatKeyValueTable([
    ['Output folder', displayPath],
  ])
}

export function resolveManifestRuntimeVersion(
  manifest: BundleManifest | null,
  platform: MobilePlatform,
) {
  if (!manifest || manifest.platform !== platform) {
    return undefined
  }

  return manifest.runtimeVersion
}

export function resolveManifestBundleId(
  manifest: BundleManifest | null,
  platform: MobilePlatform,
) {
  if (!manifest || manifest.platform !== platform) {
    return undefined
  }

  return manifest.bundleId
}

export async function resolveBundleRuntimeVersionInput(input: {
  context: CommandContext
  options: Record<string, string | boolean>
  platform: MobilePlatform
  manifest: BundleManifest | null
  isInteractive?: boolean
  prompt?: TextPrompt
  detectRuntimeVersion?: (cwd: string, platform: MobilePlatform) => Promise<string>
}) {
  const explicitRuntimeVersion = readStringOption(input.options, 'runtime-version')

  if (explicitRuntimeVersion) {
    return explicitRuntimeVersion
  }

  if (!input.isInteractive) {
    return undefined
  }

  const prompt = input.prompt ?? promptWithHint
  const detectRuntimeVersion = input.detectRuntimeVersion ?? resolveProjectRuntimeVersion
  const activeRuntimeVersion = await detectRuntimeVersion(input.context.cwd, input.platform).catch(() => undefined)
  const currentRuntimeVersion = resolveManifestRuntimeVersion(input.manifest, input.platform)
  const hintLines = [
    activeRuntimeVersion
      ? `Active runtime version: ${activeRuntimeVersion}`
      : 'Active runtime version could not be detected automatically.',
    currentRuntimeVersion && currentRuntimeVersion !== activeRuntimeVersion
      ? `Current bundle runtime version: ${currentRuntimeVersion}`
      : undefined,
    'Press Enter to use the active runtime version, or type another exact runtime version.',
  ].filter(Boolean)
  const answer = await prompt({
    question: 'Runtime version',
    fallback: activeRuntimeVersion,
    hint: hintLines.join('\n'),
  })

  return answer.trim() || undefined
}

export async function resolveBundleIdInput(input: {
  options: Record<string, string | boolean>
  platform: MobilePlatform
  runtimeVersion?: string
  manifest: BundleManifest | null
  publishedBundle?: PublishedBundleHint
  isInteractive?: boolean
  prompt?: TextPrompt
}) {
  const explicitBundleId = readStringOption(input.options, 'bundle-id')
    ?? readStringOption(input.options, 'version')

  if (explicitBundleId) {
    return {
      bundleId: explicitBundleId,
      bundleIdSource: 'flag' as const,
    }
  }

  if (
    readBooleanOption(input.options, 'bundle-from-package', false)
    || !input.isInteractive
  ) {
    return {
      bundleId: undefined,
      bundleIdSource: undefined,
    }
  }

  const prompt = input.prompt ?? promptWithHint
  const currentBundleId = resolveManifestBundleId(
    input.manifest,
    input.platform,
  )
  const hintLines = [
    currentBundleId
      ? `Local bundle ID: ${currentBundleId}`
      : 'No local bundle ID found for this platform.',
    formatPublishedBundleHint(input.publishedBundle),
    'Type the bundle ID to release, or press Enter to generate one from runtimeVersion and the bundle hash.',
  ].filter(Boolean)
  const publishedBundleId = input.publishedBundle?.bundleId
  const answer = await prompt({
    question: 'Bundle ID',
    hint: hintLines.join('\n'),
    example: currentBundleId || publishedBundleId
      ? undefined
      : `${input.runtimeVersion ?? '1.0.0'}-web.1`,
  })
  const bundleId = answer.trim()

  return {
    bundleId: bundleId || undefined,
    bundleIdSource: bundleId ? 'prompt' as const : undefined,
  }
}

export function formatPublishedBundleHint(publishedBundle?: PublishedBundleHint) {
  if (!publishedBundle) {
    return undefined
  }

  if (!publishedBundle.checked) {
    return `Published bundle ID (${publishedBundle.channel}): unavailable.`
  }

  if (!publishedBundle.bundleId) {
    return `Published bundle ID (${publishedBundle.channel}): none found.`
  }

  return `Published bundle ID (${publishedBundle.channel}): ${publishedBundle.bundleId}`
}

export function resolvePublishedBundleIdFromReleases(releases: ReleaseItem[]) {
  const activeRelease = releases.find(item => item.isActive)

  if (activeRelease) {
    return activeRelease.bundleId
  }

  return [...releases]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .at(0)
    ?.bundleId
}

export function findExistingPublishedBundle(input: {
  releases: ReleaseItem[]
  platform: MobilePlatform
  channel: string
  runtimeVersion: string
  bundleId: string
}) {
  return input.releases.find(item =>
    item.platform === input.platform
    && item.channel === input.channel
    && item.runtimeVersion === input.runtimeVersion
    && item.bundleId === input.bundleId,
  )
}

export async function resolvePublishedBundleHint(input: {
  context: CommandContext
  options: Record<string, string | boolean>
  platform: MobilePlatform
  runtimeVersion?: string
  loadPublishedBundleId?: (input: {
    channel: string
    platform: MobilePlatform
    runtimeVersion: string
  }) => Promise<string | undefined>
}): Promise<PublishedBundleHint | undefined> {
  if (!input.runtimeVersion) {
    return undefined
  }

  const channel = readStringOption(input.options, 'channel') ?? 'production'

  try {
    if (input.loadPublishedBundleId) {
      return {
        channel,
        bundleId: await input.loadPublishedBundleId({
          channel,
          platform: input.platform,
          runtimeVersion: input.runtimeVersion,
        }),
        checked: true,
      }
    }

    const api = await resolveApiConfig(input.options)
    const project = await resolveProject(input.context)

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
      platform: input.platform,
      channel,
      runtimeVersion: input.runtimeVersion,
    })

    return {
      channel,
      bundleId: resolvePublishedBundleIdFromReleases(releases),
      checked: true,
    }
  } catch {
    return {
      channel,
      checked: false,
    }
  }
}

export async function resolveExistingPublishedBundleCheck(input: {
  context: CommandContext
  options: Record<string, string | boolean>
  platform: MobilePlatform
  runtimeVersion: string
  bundleId: string
  loadExistingBundle?: (input: {
    channel: string
    platform: MobilePlatform
    runtimeVersion: string
    bundleId: string
  }) => Promise<ReleaseItem | undefined>
}): Promise<ExistingPublishedBundleCheck> {
  const channel = readStringOption(input.options, 'channel') ?? 'production'

  try {
    if (input.loadExistingBundle) {
      return {
        channel,
        checked: true,
        release: await input.loadExistingBundle({
          channel,
          platform: input.platform,
          runtimeVersion: input.runtimeVersion,
          bundleId: input.bundleId,
        }),
      }
    }

    const api = await resolveApiConfig(input.options)
    const project = await resolveProject(input.context)

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
      platform: input.platform,
      channel,
      runtimeVersion: input.runtimeVersion,
      bundleId: input.bundleId,
    })

    return {
      channel,
      checked: true,
      release: findExistingPublishedBundle({
        releases,
        platform: input.platform,
        channel,
        runtimeVersion: input.runtimeVersion,
        bundleId: input.bundleId,
      }),
    }
  } catch (error) {
    return {
      channel,
      checked: false,
      unavailableReason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function assertNoExistingPublishedBundle(input: ExistingPublishedBundleCheck) {
  if (!input.release) {
    return
  }

  throw new Error(
    `Bundle ID "${input.release.bundleId}" already exists for ${input.release.platform} `
    + `channel "${input.release.channel}" and runtimeVersion "${input.release.runtimeVersion}". `
    + 'Choose a new bundle ID before running `otalan bundle`.',
  )
}

export function warnUnavailableExistingPublishedBundleCheck(input: {
  check: ExistingPublishedBundleCheck
  platform: MobilePlatform
  runtimeVersion: string
  bundleId: string
}) {
  if (input.check.checked) {
    return
  }

  if (
    input.check.unavailableReason?.startsWith('No OTA Publish Key configured.')
    || input.check.unavailableReason?.startsWith('Missing otalan.config.json.')
  ) {
    return
  }

  printWarning(
    `Unable to verify whether bundle ID "${input.bundleId}" already exists for ${input.platform} `
    + `channel "${input.check.channel}" and runtimeVersion "${input.runtimeVersion}". `
    + 'Continuing without the duplicate-bundle guardrail.',
  )
}
