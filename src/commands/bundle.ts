import path from 'node:path'
import { stdin, stdout } from 'node:process'

import { bundleProject, resolveProjectNativeVersion } from '../bundle'
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

function isInteractiveTerminal() {
  return Boolean(stdin.isTTY && stdout.isTTY)
}

function resolveManifestNativeVersion(manifest: BundleManifest | null, platform: MobilePlatform) {
  if (!manifest || manifest.platform !== platform) {
    return undefined
  }

  return manifest.nativeVersion
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

async function resolveBundleNativeVersionInput(input: {
  context: CommandContext
  options: Record<string, string | boolean>
  platform: MobilePlatform
  manifest: BundleManifest | null
  isInteractive?: boolean
  prompt?: TextPrompt
  detectNativeVersion?: (cwd: string, platform: MobilePlatform) => Promise<string>
}) {
  const explicitNativeVersion = readStringOption(input.options, 'native-version')

  if (explicitNativeVersion) {
    return explicitNativeVersion
  }

  if (!input.isInteractive) {
    return undefined
  }

  const prompt = input.prompt ?? promptWithHint
  const detectNativeVersion = input.detectNativeVersion ?? resolveProjectNativeVersion
  const activeNativeVersion = await detectNativeVersion(input.context.cwd, input.platform).catch(() => undefined)
  const currentNativeVersion = resolveManifestNativeVersion(input.manifest, input.platform)
  const hintLines = [
    activeNativeVersion
      ? `Active native version: ${activeNativeVersion}`
      : 'Active native version could not be detected automatically.',
    currentNativeVersion && currentNativeVersion !== activeNativeVersion
      ? `Current bundle native version: ${currentNativeVersion}`
      : undefined,
    'Press Enter to use the active native version, or type another exact native app version.',
  ].filter(Boolean)
  const answer = await prompt({
    question: 'Native version',
    fallback: activeNativeVersion,
    hint: hintLines.join('\n'),
  })

  return answer.trim() || undefined
}

async function resolveBundleIdInput(input: {
  options: Record<string, string | boolean>
  platform: MobilePlatform
  nativeVersion?: string
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
    'Type the bundle ID to release, or press Enter to generate one from nativeVersion and the bundle hash.',
  ].filter(Boolean)
  const publishedBundleId = input.publishedBundle?.bundleId
  const answer = await prompt({
    question: 'Bundle ID',
    hint: hintLines.join('\n'),
    example: currentBundleId || publishedBundleId
      ? undefined
      : `${input.nativeVersion ?? '1.0.0'}-web.1`,
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
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .at(0)
    ?.bundleId
}

async function resolvePublishedBundleHint(input: {
  context: CommandContext
  options: Record<string, string | boolean>
  platform: MobilePlatform
  nativeVersion?: string
  loadPublishedBundleId?: (input: {
    channel: string
    platform: MobilePlatform
    nativeVersion: string
  }) => Promise<string | undefined>
}): Promise<PublishedBundleHint | undefined> {
  if (!input.nativeVersion) {
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
          nativeVersion: input.nativeVersion,
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
      nativeVersion: input.nativeVersion,
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

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export async function handleBundle(context: CommandContext, options: Record<string, string | boolean>) {
  const targetFallback = readStringOption(options, 'target')
    ? undefined
    : await promptSelectWithHint({
      question: 'Target',
      fallback: 'capacitor',
      hint: 'OTA client type: capacitor or expo. Use expo for Expo or React Native projects.',
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
  const nativeVersion = await resolveBundleNativeVersionInput({
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
      nativeVersion,
    })
    : undefined
  const bundleIdInput = await resolveBundleIdInput({
    options,
    platform,
    nativeVersion,
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
    nativeVersion,
    runtimeVersion: readStringOption(options, 'runtime-version'),
    platform,
    target,
  })

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
  resolveBundleNativeVersionInput,
  resolveManifestBundleId,
  resolveManifestNativeVersion,
  resolvePublishedBundleIdFromReleases,
  resolvePublishedBundleHint,
}
