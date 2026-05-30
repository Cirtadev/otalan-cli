import { rm } from 'node:fs/promises'
import path from 'node:path'

import { findNativeBundleEntries } from './bundle-validation'
import {
  assertLocalExpoCliAvailable,
  buildExpoAssetManifest,
  createExpoExportDirectory,
  findRuntimeVersionInObject,
  readExpoConfig,
  readExpoExportRuntimeVersion,
  resolveExpoConfiguredVersion,
  resolveExpoRuntimeVersion,
} from './bundle-expo'
import {
  collectDirectoryEntries,
  hashBytes,
  pathIsDirectory,
  readPackageVersion,
  writeBundleOutput,
  zipDirectory,
} from './bundle-files'
import {
  createAutoBundleId,
  createBundleArchiveFileName,
  formatOmittedSourceMapCount,
  normalizeBundleId,
  resolveBundleId,
} from './bundle-id'
import {
  resolveCapacitorRuntimeVersion,
  resolveProjectRuntimeVersion,
} from './bundle-runtime'
import {
  LEGACY_BUNDLE_ARCHIVE_FILE_NAME,
  type BundleOptions,
  type BundleResult,
  type CapacitorBundleManifest,
  type ExpoBundleManifest,
} from './bundle-types'

export {
  createBundleArchiveFileName,
  formatOmittedSourceMapCount,
  LEGACY_BUNDLE_ARCHIVE_FILE_NAME,
  resolveProjectRuntimeVersion,
}
export type {
  BundleIdSource,
  BundleManifest,
  CapacitorBundleManifest,
  ExpoBundleManifest,
} from './bundle-types'

function resolveCapacitorInputDir(cwd: string, inputDir?: string) {
  const candidates = inputDir
    ? [inputDir]
    : ['dist', 'www']

  return candidates.map(candidate => path.resolve(cwd, candidate))
}

async function resolveFirstDirectory(paths: string[]) {
  for (const directoryPath of paths) {
    if (await pathIsDirectory(directoryPath)) {
      return directoryPath
    }
  }

  return null
}

type CommandRunOptions = {
  verbose?: boolean
}

async function readProcessStream(stream: ReadableStream<Uint8Array> | null | undefined) {
  return stream ? await new Response(stream).text() : ''
}

function truncateProcessOutput(value: string) {
  const trimmed = value.trim()
  const maxLength = 4_000

  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, maxLength)}\n...`
}

function formatCommandFailure(commandLine: string, exitCode: number, output: { stderr: string, stdout: string }) {
  const details = [
    output.stderr ? `stderr:\n${truncateProcessOutput(output.stderr)}` : undefined,
    output.stdout ? `stdout:\n${truncateProcessOutput(output.stdout)}` : undefined,
  ].filter(Boolean).join('\n\n')

  if (!details) {
    return `${commandLine} exited with code ${exitCode}`
  }

  return `${commandLine} exited with code ${exitCode}\n\n${details}`
}

async function runCommand(command: string, args: string[], cwd: string, options: CommandRunOptions = {}) {
  const verbose = options.verbose ?? false
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdin: verbose ? 'inherit' : 'ignore',
    stdout: verbose ? 'inherit' : 'pipe',
    stderr: verbose ? 'inherit' : 'pipe',
  })
  const stdoutPromise = verbose
    ? Promise.resolve('')
    : readProcessStream(proc.stdout)
  const stderrPromise = verbose
    ? Promise.resolve('')
    : readProcessStream(proc.stderr)
  const [exitCode, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    stdoutPromise,
    stderrPromise,
  ])

  if (exitCode !== 0) {
    throw new Error(formatCommandFailure(`${command} ${args.join(' ')}`, exitCode, {
      stderr: stderrText,
      stdout: stdoutText,
    }))
  }
}

export async function bundleProject(options: BundleOptions): Promise<BundleResult> {
  if (options.target === 'capacitor') {
    return bundleCapacitorProject(options)
  }

  return bundleExpoProject(options)
}

async function bundleCapacitorProject(options: BundleOptions): Promise<BundleResult> {
  const inputDirectory = await resolveFirstDirectory(
    resolveCapacitorInputDir(options.cwd, options.inputDir),
  )

  if (!inputDirectory) {
    throw new Error('Unable to find a Capacitor web directory. Build your app first, then run `otalan bundle`. Checked dist/ and www/.')
  }

  const bundleArchive = await zipDirectory(inputDirectory)
  const hash = hashBytes(bundleArchive.bytes)
  const runtimeVersion = await resolveCapacitorRuntimeVersion(
    options.cwd,
    options.platform,
    options.runtimeVersion,
  )
  const packageVersion = await readPackageVersion(options.cwd)
  const { bundleId, bundleIdSource } = resolveBundleId({
    bundleId: options.bundleId,
    bundleFromPackage: options.bundleFromPackage,
    explicitBundleIdSource: options.explicitBundleIdSource,
    packageVersion,
    runtimeVersion,
    hash,
  })
  const manifest: CapacitorBundleManifest = {
    target: 'capacitor',
    hash,
    runtimeVersion,
    bundleId,
    createdAt: new Date().toISOString(),
    platform: options.platform,
  }

  await options.beforeWrite?.(manifest)
  const archiveFileName = await writeBundleOutput(options.outputDir, bundleArchive.bytes, manifest)

  return {
    outputDir: options.outputDir,
    archiveFileName,
    manifest,
    bundleIdSource,
    omittedSourceMapCount: bundleArchive.omittedSourceMapCount,
  }
}

async function bundleExpoProject(options: BundleOptions): Promise<BundleResult> {
  await assertLocalExpoCliAvailable(options.cwd)

  const exportDir = await createExpoExportDirectory(options.cwd)

  try {
    await runCommand(
      'bunx',
      ['expo', 'export', '--platform', options.platform, '--output-dir', exportDir],
      options.cwd,
      { verbose: options.verbose },
    )

    const exportedRuntimeVersion = await readExpoExportRuntimeVersion(exportDir, options.platform)
    const expoConfig = await readExpoConfig(options.cwd, { verbose: options.verbose })
    const runtimeVersion = resolveExpoRuntimeVersion(
      expoConfig,
      options.platform,
      options.runtimeVersion,
      exportedRuntimeVersion,
      resolveExpoConfiguredVersion(expoConfig, options.platform),
    )
    const bundleArchive = await zipDirectory(exportDir)
    const hash = hashBytes(bundleArchive.bytes)
    const assets = await buildExpoAssetManifest(exportDir)
    const packageVersion = await readPackageVersion(options.cwd)
    const { bundleId, bundleIdSource } = resolveBundleId({
      bundleId: options.bundleId,
      bundleFromPackage: options.bundleFromPackage,
      explicitBundleIdSource: options.explicitBundleIdSource,
      packageVersion,
      runtimeVersion,
      hash,
    })
    const manifest: ExpoBundleManifest = {
      target: 'expo',
      hash,
      runtimeVersion,
      bundleId,
      launchAsset: assets.launchAsset,
      assets: assets.assets,
      expoConfig,
      createdAt: new Date().toISOString(),
      platform: options.platform,
    }

    await options.beforeWrite?.(manifest)
    const archiveFileName = await writeBundleOutput(options.outputDir, bundleArchive.bytes, manifest)

    return {
      outputDir: options.outputDir,
      archiveFileName,
      manifest,
      bundleIdSource,
      omittedSourceMapCount: bundleArchive.omittedSourceMapCount,
    }
  } finally {
    await rm(exportDir, { recursive: true, force: true })
  }
}

export const bundleTestUtils = {
  collectDirectoryEntries,
  createAutoBundleId,
  createBundleArchiveFileName,
  createExpoExportDirectory,
  findNativeBundleEntries,
  findRuntimeVersionInObject,
  formatOmittedSourceMapCount,
  normalizeBundleId,
  resolveBundleId,
  resolveExpoRuntimeVersion,
  zipDirectory,
}
