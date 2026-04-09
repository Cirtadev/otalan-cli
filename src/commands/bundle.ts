import path from 'node:path'

import { bundleProject } from '../bundle'
import { readBooleanOption, readStringOption } from '../cli/args'
import { resolvePlatform, resolveTarget, type CommandContext } from '../cli/helpers'
import type { MobilePlatform, Target } from '../config'
import { formatBundleIdSource, printJson } from '../cli/output'
import { promptSelectWithHint } from '../cli/prompts'

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
  const outputDir = path.resolve(
    context.cwd,
    readStringOption(options, 'output-dir') ?? '.otalan/bundle',
  )

  if (target === 'capacitor') {
    console.log('')
    console.log('Build web assets before running `otalan bundle`.')
    console.log('')
  }

  const result = await bundleProject({
    cwd: context.cwd,
    outputDir,
    inputDir: readStringOption(options, 'input-dir'),
    bundleId: readStringOption(options, 'bundle-id')
      ?? readStringOption(options, 'version'),
    bundleFromPackage: readBooleanOption(options, 'bundle-from-package', false),
    nativeVersion: readStringOption(options, 'native-version'),
    runtimeVersion: readStringOption(options, 'runtime-version'),
    platform,
    target,
  })

  console.log(formatBundleIdSource(result.bundleIdSource))
  console.log('')
  printJson(result)
}
