import path from 'node:path'
import { stdin, stdout } from 'node:process'

import { bundleProject, formatOmittedSourceMapCount, resolveProjectRuntimeVersion } from '../bundle'
import { readBooleanOption, readStringOption } from '../cli/args'
import {
  assertReleaseContextMatchesConfig,
  readBundleManifestIfExists,
  resolveApiConfig,
  resolvePlatform,
  resolveProject,
  resolveTarget,
  type CommandContext,
} from '../cli/helpers'
import type { MobilePlatform, Target } from '../config'
import { formatBundleIdSource, printJson } from '../cli/output'
import { promptSelectWithHint, promptWithHint, type PromptWithHintInput } from '../cli/prompts'
import type { BundleManifest } from '../bundle'
import { listReleases, type ReleaseItem } from '../http'

// -----------------------------------------------------------------------------
// Prompt options
// -----------------------------------------------------------------------------

const TARGET_OPTIONS = [
  { label: 'capacitor', value: 'capacitor' },
  { label: 'expo', value: 'expo' },
] as const satisfies ReadonlyArray<{ label: string, value: Target }>

const PLATFORM_OPTIONS = [
  { label: 'ios', value: 'ios' },
  { label: 'android', value: 'android' },
] as const satisfies ReadonlyArray<{ label: string, value: MobilePlatform }>

// -----------------------------------------------------------------------------
// Prompt helpers
// -----------------------------------------------------------------------------

type TextPrompt = (input: PromptWithHintInput) => Promise<string>

type PublishedBundleHint = {
  channel: string
  bundleId?: string
  checked: boolean
}

type ExistingPublishedBundleCheck = {
  channel: string
  checked: boolean
  release?: ReleaseItem
}

function isInteractiveTerminal() {
  return Boolean(stdin.isTTY && stdout.isTTY)
}

function resolveManifestRuntimeVersion(manifest: BundleManifest | null, platform: MobilePlatform) {
  if (!manifest || manifest.platform !== platform) {
    return undefined
  }

  return manifest.runtimeVersion
}

function resolveManifestBundleId(
  manifest: BundleManifest | null,
  platform: MobilePlatform,
) {
  if (!manifest || manifest.platform !== platform) {
    return undefined
  }

  return manifest.bundleId
}

async function resolveBundleRuntimeVersionInput(input: {
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

async function resolveBundleIdInput(input: {
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

function formatPublishedBundleHint(publishedBundle?: PublishedBundleHint) {
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

function resolvePublishedBundleIdFromReleases(releases: ReleaseItem[]) {
  const activeRelease = releases.find(item => item.isActive)

  if (activeRelease) {
    return activeRelease.bundleId
  }

  return [...releases]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .at(0)
    ?.bundleId
}

function findExistingPublishedBundle(input: {
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

async function resolvePublishedBundleHint(input: {
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

async function resolveExistingPublishedBundleCheck(input: {
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
  } catch {
    return {
      channel,
      checked: false,
    }
  }
}

function assertNoExistingPublishedBundle(input: ExistingPublishedBundleCheck) {
  if (!input.release) {
    return
  }

  throw new Error(
    `Bundle ID "${input.release.bundleId}" already exists for ${input.release.platform} `
    + `channel "${input.release.channel}" and runtimeVersion "${input.release.runtimeVersion}". `
    + 'Choose a new bundle ID before running `otalan bundle`.',
  )
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export async function handleBundle(context: CommandContext, options: Record<string, string | boolean>) {
  const targetFallback = readStringOption(options, 'target')
    ? undefined
    : await promptSelectWithHint({
      question: 'Target',
      fallback: 'capacitor',
      hint: 'OTA client type: capacitor or expo. Use expo for Expo projects.',
      options: TARGET_OPTIONS,
    })
  const target = resolveTarget(
    options,
    targetFallback,
  )
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptSelectWithHint({
      question: 'Platform',
      hint: 'Target mobile platform: ios or android.',
      options: PLATFORM_OPTIONS,
    })
  const platform = resolvePlatform(
    options,
    platformFallback,
  )
  const interactive = isInteractiveTerminal()
  const outputDir = path.resolve(
    context.cwd,
    readStringOption(options, 'output-dir') ?? '.otalan/bundle',
  )
  const manifest = await readBundleManifestIfExists(outputDir)
  const runtimeVersion = await resolveBundleRuntimeVersionInput({
    context,
    options,
    platform,
    manifest,
    isInteractive: interactive,
  })
  const shouldPromptForBundleId = interactive
    && !readStringOption(options, 'bundle-id')
    && !readStringOption(options, 'version')
    && !readBooleanOption(options, 'bundle-from-package', false)
  const publishedBundle = shouldPromptForBundleId
    ? await resolvePublishedBundleHint({
      context,
      options,
      platform,
      runtimeVersion,
    })
    : undefined
  const bundleIdInput = await resolveBundleIdInput({
    options,
    platform,
    runtimeVersion,
    manifest,
    publishedBundle,
    isInteractive: interactive,
  })

  if (target === 'capacitor') {
    console.log('')
    console.log('Build web assets before running `otalan bundle`.')
    console.log('')
  }

  const result = await bundleProject({
    cwd: context.cwd,
    outputDir,
    inputDir: readStringOption(options, 'input-dir'),
    bundleId: bundleIdInput.bundleId,
    bundleFromPackage: readBooleanOption(options, 'bundle-from-package', false),
    explicitBundleIdSource: bundleIdInput.bundleIdSource,
    runtimeVersion,
    platform,
    target,
    beforeWrite: async manifest => {
      const existingBundleCheck = await resolveExistingPublishedBundleCheck({
        context,
        options,
        platform: manifest.platform,
        runtimeVersion: manifest.runtimeVersion,
        bundleId: manifest.bundleId,
      })

      assertNoExistingPublishedBundle(existingBundleCheck)
    },
  })

  if (result.omittedSourceMapCount > 0) {
    console.log(formatOmittedSourceMapCount(result.omittedSourceMapCount))
  }

  console.log(formatBundleIdSource(result.bundleIdSource))
  console.log('')
  printJson(result)
}

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

export const bundleCommandTestUtils = {
  formatPublishedBundleHint,
  resolveBundleIdInput,
  resolveBundleRuntimeVersionInput,
  resolveManifestBundleId,
  resolveManifestRuntimeVersion,
  assertNoExistingPublishedBundle,
  findExistingPublishedBundle,
  resolveExistingPublishedBundleCheck,
  resolvePublishedBundleIdFromReleases,
  resolvePublishedBundleHint,
}
