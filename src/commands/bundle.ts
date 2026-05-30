import path from 'node:path'

import { bundleProject, formatOmittedSourceMapCount } from '../bundle'
import { readBooleanOption, readStringOption } from '../cli/args'
import {
  readBundleManifestIfExists,
  resolvePlatform,
  resolveTarget,
  type CommandContext,
} from '../cli/helpers'
import { formatBundleIdSource, printJson } from '../cli/output'
import { createProgressReporter } from '../cli/progress'
import { promptSelectWithHint } from '../cli/prompts'
import { printSuccess } from '../cli/ui'
import {
  assertNoExistingPublishedBundle,
  findExistingPublishedBundle,
  formatBundleDirectoryHint,
  formatPublishedBundleHint,
  isInteractiveTerminal,
  isVerboseOutput,
  PLATFORM_OPTIONS,
  printBundleProjectContext,
  resolveBundleIdInput,
  resolveBundleRuntimeVersionInput,
  resolveExistingPublishedBundleCheck,
  resolveManifestBundleId,
  resolveManifestRuntimeVersion,
  resolvePublishedBundleHint,
  resolvePublishedBundleIdFromReleases,
  TARGET_OPTIONS,
  warnUnavailableExistingPublishedBundleCheck,
} from './bundle-input'

export async function handleBundle(context: CommandContext, options: Record<string, string | boolean>) {
  const verbose = isVerboseOutput(options)

  if (verbose) {
    await printBundleProjectContext(context)
  }

  const targetFallback = readStringOption(options, 'target')
    ? undefined
    : await promptSelectWithHint({
      question: 'Target',
      fallback: 'capacitor',
      hint: 'OTA client type: capacitor or expo.',
      options: TARGET_OPTIONS,
    })
  const target = resolveTarget(options, targetFallback)
  const platformFallback = readStringOption(options, 'platform')
    ? undefined
    : await promptSelectWithHint({
      question: 'Platform',
      hint: 'Target mobile platform: ios or android.',
      options: PLATFORM_OPTIONS,
    })
  const platform = resolvePlatform(options, platformFallback)
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

  if (target === 'capacitor' && verbose) {
    console.log('')
    console.log('Build web assets before running `otalan bundle`.')
    console.log('')
  }

  console.log('')

  const bundling = createProgressReporter({
    animated: isInteractiveTerminal(),
  }).start('Bundling')
  let result: Awaited<ReturnType<typeof bundleProject>>

  try {
    result = await bundleProject({
      cwd: context.cwd,
      outputDir,
      inputDir: readStringOption(options, 'input-dir'),
      bundleId: bundleIdInput.bundleId,
      bundleFromPackage: readBooleanOption(options, 'bundle-from-package', false),
      explicitBundleIdSource: bundleIdInput.bundleIdSource,
      runtimeVersion,
      platform,
      target,
      verbose,
      beforeWrite: async manifest => {
        const existingBundleCheck = await resolveExistingPublishedBundleCheck({
          context,
          options,
          platform: manifest.platform,
          runtimeVersion: manifest.runtimeVersion,
          bundleId: manifest.bundleId,
        })

        warnUnavailableExistingPublishedBundleCheck({
          check: existingBundleCheck,
          platform: manifest.platform,
          runtimeVersion: manifest.runtimeVersion,
          bundleId: manifest.bundleId,
        })
        assertNoExistingPublishedBundle(existingBundleCheck)
      },
    })
    bundling.succeed()
  } catch (error) {
    bundling.fail()
    throw error
  }

  console.log('')
  printSuccess('Bundle created')
  console.log(formatBundleDirectoryHint({
    cwd: context.cwd,
    outputDir,
  }))

  if (!verbose) {
    return
  }

  if (result.omittedSourceMapCount > 0) {
    console.log(formatOmittedSourceMapCount(result.omittedSourceMapCount))
  }

  console.log(formatBundleIdSource(result.bundleIdSource))
  console.log('')
  printJson(result)
}

export const bundleCommandTestUtils = {
  assertNoExistingPublishedBundle,
  findExistingPublishedBundle,
  formatBundleDirectoryHint,
  formatPublishedBundleHint,
  resolveBundleIdInput,
  resolveBundleRuntimeVersionInput,
  resolveExistingPublishedBundleCheck,
  resolveManifestBundleId,
  resolveManifestRuntimeVersion,
  resolvePublishedBundleHint,
  resolvePublishedBundleIdFromReleases,
  warnUnavailableExistingPublishedBundleCheck,
}
