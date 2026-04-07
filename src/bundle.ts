import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { zipSync } from 'fflate'

import type { MobilePlatform, ProjectConfig, Target } from './config'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type CapacitorBundleManifest = {
  type: 'capacitor'
  hash: string
  version: string
  bundleId: string
  createdAt: string
  platform?: MobilePlatform
}

export type ExpoBundleManifest = {
  type: 'expo'
  hash: string
  runtimeVersion: string
  bundleId: string
  launchAsset: string
  assets: string[]
  createdAt: string
  platform?: MobilePlatform
}

export type BundleManifest = CapacitorBundleManifest | ExpoBundleManifest
export type BundleIdSource = 'flag' | 'native-version' | 'package-json'

type BundleOptions = {
  cwd: string
  outputDir: string
  bundleId?: string
  bundleFromPackage?: boolean
  nativeVersion?: string
  runtimeVersion?: string
  inputDir?: string
  platform?: MobilePlatform
  projectConfig?: ProjectConfig
  target: Target
}

type BundleResult = {
  outputDir: string
  manifest: BundleManifest
  bundleIdSource: BundleIdSource
}

// -----------------------------------------------------------------------------
// File helpers
// -----------------------------------------------------------------------------

async function pathExists(filePath: string) {
  return Bun.file(filePath).exists()
}

async function pathIsDirectory(directoryPath: string) {
  try {
    await readdir(directoryPath)
    return true
  } catch {
    return false
  }
}

async function collectDirectoryEntries(rootDir: string, currentDir = rootDir) {
  const entries: Record<string, Uint8Array> = {}
  const items = await readdir(currentDir, { withFileTypes: true })

  for (const item of items) {
    const absolutePath = path.join(currentDir, item.name)

    if (item.isDirectory()) {
      const nestedEntries = await collectDirectoryEntries(rootDir, absolutePath)

      Object.assign(entries, nestedEntries)
      continue
    }

    if (!item.isFile()) {
      continue
    }

    const relativePath = path
      .relative(rootDir, absolutePath)
      .split(path.sep)
      .join(path.posix.sep)

    entries[relativePath] = new Uint8Array(await Bun.file(absolutePath).arrayBuffer())
  }

  return entries
}

async function zipDirectory(directoryPath: string) {
  const entries = await collectDirectoryEntries(directoryPath)

  if (Object.keys(entries).length === 0) {
    throw new Error(`No files found in ${directoryPath}`)
  }

  return zipSync(entries, { level: 9 })
}

async function writeBundleOutput(outputDir: string, bundleBytes: Uint8Array, manifest: BundleManifest) {
  await mkdir(outputDir, { recursive: true })
  await Bun.write(path.join(outputDir, 'bundle.zip'), bundleBytes)
  await Bun.write(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

function hashBytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizeBundleId(seed: string) {
  const normalizedSeed = seed
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'bundle'

  return normalizedSeed
}

function createAutoBundleId(seed: string, hash: string) {
  return `${normalizeBundleId(seed)}-${hash.slice(0, 12)}`
}

async function readPackageVersion(cwd: string) {
  const packageJsonPath = path.join(cwd, 'package.json')

  if (!(await pathExists(packageJsonPath))) {
    return undefined
  }

  const raw = JSON.parse(await Bun.file(packageJsonPath).text()) as {
    version?: string
  }

  return raw.version
}

function resolveConfiguredNativeVersion(options: BundleOptions) {
  return options.nativeVersion ?? options.projectConfig?.nativeVersion
}

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

// -----------------------------------------------------------------------------
// Command helpers
// -----------------------------------------------------------------------------

async function runCommand(command: string, args: string[], cwd: string) {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${exitCode}`)
  }
}

async function resolveExpoRuntimeVersion(cwd: string, runtimeVersion?: string) {
  if (runtimeVersion) {
    return runtimeVersion
  }

  const proc = Bun.spawn(['bunx', 'expo', 'config', '--json'], {
    cwd,
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error(`bunx expo config --json exited with code ${exitCode}`)
  }

  const output = await new Response(proc.stdout).text()

  const parsed = JSON.parse(output) as {
    exp?: {
      runtimeVersion?: string | Record<string, unknown>
    }
    expo?: {
      runtimeVersion?: string | Record<string, unknown>
    }
  }

  const resolved = parsed.exp?.runtimeVersion ?? parsed.expo?.runtimeVersion

  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new Error('Expo runtimeVersion is required. Pass --bundle-id or set a string runtimeVersion in Expo config.')
  }

  return resolved
}

async function buildExpoAssetManifest(exportDir: string) {
  const entries = await collectDirectoryEntries(exportDir)
  const assetPaths = Object.keys(entries)
    .filter(relativePath => !relativePath.endsWith('.map'))
    .filter(relativePath => !relativePath.endsWith('metadata.json'))
    .filter(relativePath => !relativePath.endsWith('assetmap.json'))
    .sort()

  const launchAsset = assetPaths.find(relativePath => relativePath.endsWith('.js') || relativePath.endsWith('.hbc'))

  if (!launchAsset) {
    throw new Error('Unable to find Expo launch asset in export output.')
  }

  return {
    launchAsset,
    assets: assetPaths.filter(relativePath => relativePath !== launchAsset),
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

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

  const bundleBytes = await zipDirectory(inputDirectory)
  const hash = hashBytes(bundleBytes)
  const nativeVersion = resolveConfiguredNativeVersion(options)
  const packageVersion = await readPackageVersion(options.cwd)
  let bundleId: string
  let bundleIdSource: BundleIdSource

  if (options.bundleId) {
    bundleId = normalizeBundleId(options.bundleId)
    bundleIdSource = 'flag'
  } else if (options.bundleFromPackage) {
    if (!packageVersion) {
      throw new Error('`--bundle-from-package` requires a package.json version.')
    }

    bundleId = normalizeBundleId(packageVersion)
    bundleIdSource = 'package-json'
  } else if (nativeVersion) {
    bundleId = createAutoBundleId(nativeVersion, hash)
    bundleIdSource = 'native-version'
  } else {
    throw new Error('Bundle ID requires nativeVersion in otalan.config.json or --native-version. Use --bundle-from-package to take it from package.json or --bundle-id to set it explicitly.')
  }

  const version = packageVersion ?? nativeVersion ?? bundleId
  const manifest: CapacitorBundleManifest = {
    type: 'capacitor',
    hash,
    version,
    bundleId,
    createdAt: new Date().toISOString(),
    platform: options.platform ?? options.projectConfig?.platform,
  }

  await writeBundleOutput(options.outputDir, bundleBytes, manifest)

  return {
    outputDir: options.outputDir,
    manifest,
    bundleIdSource,
  }
}

async function bundleExpoProject(options: BundleOptions): Promise<BundleResult> {
  const exportDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-expo-export-'))

  try {
    await runCommand('bunx', ['expo', 'export', '--output-dir', exportDir], options.cwd)

    const runtimeVersion = await resolveExpoRuntimeVersion(options.cwd, options.runtimeVersion)
    const bundleBytes = await zipDirectory(exportDir)
    const hash = hashBytes(bundleBytes)
    const assets = await buildExpoAssetManifest(exportDir)
    const nativeVersion = resolveConfiguredNativeVersion(options)
    const packageVersion = await readPackageVersion(options.cwd)
    let bundleId: string
    let bundleIdSource: BundleIdSource

    if (options.bundleId) {
      bundleId = normalizeBundleId(options.bundleId)
      bundleIdSource = 'flag'
    } else if (options.bundleFromPackage) {
      if (!packageVersion) {
        throw new Error('`--bundle-from-package` requires a package.json version.')
      }

      bundleId = normalizeBundleId(packageVersion)
      bundleIdSource = 'package-json'
    } else if (nativeVersion) {
      bundleId = createAutoBundleId(nativeVersion, hash)
      bundleIdSource = 'native-version'
    } else {
      throw new Error('Bundle ID requires nativeVersion in otalan.config.json or --native-version. Use --bundle-from-package to take it from package.json or --bundle-id to set it explicitly.')
    }

    const manifest: ExpoBundleManifest = {
      type: 'expo',
      hash,
      runtimeVersion,
      bundleId,
      launchAsset: assets.launchAsset,
      assets: assets.assets,
      createdAt: new Date().toISOString(),
      platform: options.platform ?? options.projectConfig?.platform,
    }

    await writeBundleOutput(options.outputDir, bundleBytes, manifest)

    return {
      outputDir: options.outputDir,
      manifest,
      bundleIdSource,
    }
  } finally {
    await rm(exportDir, { recursive: true, force: true })
  }
}
