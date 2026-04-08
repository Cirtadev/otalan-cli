import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { zipSync } from 'fflate'

import type { MobilePlatform, Target } from './config'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type BundleBaseManifest = {
  target: Target
  hash: string
  nativeVersion: string
  bundleId: string
  createdAt: string
  platform: MobilePlatform
}

export type CapacitorBundleManifest = BundleBaseManifest & {
  target: 'capacitor'
}

export type ExpoBundleManifest = BundleBaseManifest & {
  target: 'expo'
  runtimeVersion: string
  launchAsset: string
  assets: string[]
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
  platform: MobilePlatform
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

async function readTextFileIfExists(filePath: string) {
  if (!(await pathExists(filePath))) {
    return null
  }

  return Bun.file(filePath).text()
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

type ExpoConfig = {
  runtimeVersion?: string | Record<string, unknown>
  version?: string
  ios?: {
    version?: string
  }
  android?: {
    version?: string
  }
}

async function readExpoConfig(cwd: string): Promise<ExpoConfig> {
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
    exp?: ExpoConfig
    expo?: ExpoConfig
  }

  return parsed.exp ?? parsed.expo ?? {}
}

function resolveExpoRuntimeVersion(config: ExpoConfig, runtimeVersion?: string) {
  if (runtimeVersion) {
    return runtimeVersion
  }

  const resolved = config.runtimeVersion

  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new Error('Expo runtimeVersion is required. Pass --bundle-id or set a string runtimeVersion in Expo config.')
  }

  return resolved
}

function resolveExpoNativeVersion(config: ExpoConfig, platform: MobilePlatform, nativeVersion?: string) {
  if (nativeVersion) {
    return nativeVersion
  }

  const platformVersion = platform === 'ios'
    ? config.ios?.version
    : config.android?.version
  const resolved = platformVersion ?? config.version

  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new Error('Unable to resolve Expo native version. Pass --native-version or set a version in Expo config.')
  }

  return resolved
}

function extractIosPlistString(contents: string, key: string) {
  const match = contents.match(new RegExp(`<key>\\s*${key}\\s*<\\/key>\\s*<string>\\s*([^<]+?)\\s*<\\/string>`, 's'))
  return match?.[1]?.trim()
}

function extractXcodeBuildSettingReference(value: string) {
  const match = value.trim().match(/^\$\(([^):]+)(?::[^)]+)?\)$|^\$\{([^}:]+)(?::[^}]+)?\}$/)
  return match?.[1] ?? match?.[2]
}

function extractXcodeBuildSettingValue(contents: string, key: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [
    ...contents.matchAll(new RegExp(`\\b${escapedKey}\\s*=\\s*([^;\\n]+)\\s*;`, 'g')),
    ...contents.matchAll(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'gm')),
  ]
  const value = matches.at(-1)?.[1]?.trim()

  if (!value) {
    return undefined
  }

  return value
    .replace(/;\s*$/, '')
    .replace(/^["']|["']$/g, '')
    .trim()
}

async function resolveIosBuildSetting(cwd: string, key: string, seen = new Set<string>()): Promise<string | undefined> {
  if (seen.has(key)) {
    return undefined
  }

  const nextSeen = new Set(seen)
  nextSeen.add(key)
  const candidates = [
    path.join(cwd, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
    path.join(cwd, 'ios', 'App.xcodeproj', 'project.pbxproj'),
  ]

  for (const candidate of candidates) {
    const contents = await readTextFileIfExists(candidate)

    if (!contents) {
      continue
    }

    const value = extractXcodeBuildSettingValue(contents, key)

    if (!value) {
      continue
    }

    const nestedReference = extractXcodeBuildSettingReference(value)

    if (!nestedReference) {
      return value
    }

    const resolvedNestedValue: string | undefined = await resolveIosBuildSetting(cwd, nestedReference, nextSeen)

    if (resolvedNestedValue) {
      return resolvedNestedValue
    }
  }

  return undefined
}

async function resolveIosVersionValue(cwd: string, value: string) {
  const buildSettingReference = extractXcodeBuildSettingReference(value)

  if (!buildSettingReference) {
    return value
  }

  const resolvedValue = await resolveIosBuildSetting(cwd, buildSettingReference)

  if (resolvedValue) {
    return resolvedValue
  }

  throw new Error(`Unable to resolve iOS native version placeholder "${value}". Pass --native-version or ensure ${buildSettingReference} is defined in the Xcode project.`)
}

async function resolveIosNativeVersion(cwd: string, nativeVersion?: string) {
  if (nativeVersion) {
    return nativeVersion
  }

  const candidates = [
    path.join(cwd, 'ios', 'App', 'App', 'Info.plist'),
    path.join(cwd, 'ios', 'App', 'Info.plist'),
  ]

  for (const candidate of candidates) {
    const contents = await readTextFileIfExists(candidate)

    if (!contents) {
      continue
    }

    const version = extractIosPlistString(contents, 'CFBundleShortVersionString')

    if (version) {
      return resolveIosVersionValue(cwd, version)
    }
  }

  throw new Error('Unable to resolve iOS native version. Pass --native-version or ensure Info.plist defines CFBundleShortVersionString.')
}

async function resolveAndroidNativeVersion(cwd: string, nativeVersion?: string) {
  if (nativeVersion) {
    return nativeVersion
  }

  const candidates = [
    path.join(cwd, 'android', 'app', 'build.gradle'),
    path.join(cwd, 'android', 'app', 'build.gradle.kts'),
  ]

  for (const candidate of candidates) {
    const contents = await readTextFileIfExists(candidate)

    if (!contents) {
      continue
    }

    const match = contents.match(/versionName\s*(?:=)?\s*["']([^"']+)["']/)

    if (match?.[1]) {
      return match[1].trim()
    }
  }

  throw new Error('Unable to resolve Android native version. Pass --native-version or ensure build.gradle defines versionName as a string literal.')
}

async function resolveCapacitorNativeVersion(
  cwd: string,
  platform: MobilePlatform,
  nativeVersion?: string,
) {
  if (platform === 'ios') {
    return resolveIosNativeVersion(cwd, nativeVersion)
  }

  return resolveAndroidNativeVersion(cwd, nativeVersion)
}

export async function resolveProjectNativeVersion(
  cwd: string,
  platform: MobilePlatform,
  nativeVersion?: string,
) {
  if (nativeVersion) {
    return nativeVersion
  }

  const nativeResolver = platform === 'ios'
    ? resolveIosNativeVersion
    : resolveAndroidNativeVersion
  const nativeResult = await nativeResolver(cwd).catch(() => null)

  if (nativeResult) {
    return nativeResult
  }

  const expoConfig = await readExpoConfig(cwd).catch(() => null)

  if (expoConfig) {
    return resolveExpoNativeVersion(expoConfig, platform)
  }

  throw new Error(`Unable to resolve ${platform} native version. Pass --native-version to override.`)
}

function resolveBundleId(input: {
  bundleId?: string
  bundleFromPackage?: boolean
  packageVersion?: string
  nativeVersion: string
  hash: string
}) {
  if (input.bundleId) {
    return {
      bundleId: normalizeBundleId(input.bundleId),
      bundleIdSource: 'flag' as const,
    }
  }

  if (input.bundleFromPackage) {
    if (!input.packageVersion) {
      throw new Error('`--bundle-from-package` requires a package.json version.')
    }

    return {
      bundleId: normalizeBundleId(input.packageVersion),
      bundleIdSource: 'package-json' as const,
    }
  }

  return {
    bundleId: createAutoBundleId(input.nativeVersion, input.hash),
    bundleIdSource: 'native-version' as const,
  }
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
  const nativeVersion = await resolveCapacitorNativeVersion(
    options.cwd,
    options.platform,
    options.nativeVersion,
  )
  const packageVersion = await readPackageVersion(options.cwd)
  const { bundleId, bundleIdSource } = resolveBundleId({
    bundleId: options.bundleId,
    bundleFromPackage: options.bundleFromPackage,
    packageVersion,
    nativeVersion,
    hash,
  })
  const manifest: CapacitorBundleManifest = {
    target: 'capacitor',
    hash,
    nativeVersion,
    bundleId,
    createdAt: new Date().toISOString(),
    platform: options.platform,
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

    const expoConfig = await readExpoConfig(options.cwd)
    const runtimeVersion = resolveExpoRuntimeVersion(expoConfig, options.runtimeVersion)
    const bundleBytes = await zipDirectory(exportDir)
    const hash = hashBytes(bundleBytes)
    const assets = await buildExpoAssetManifest(exportDir)
    const nativeVersion = resolveExpoNativeVersion(expoConfig, options.platform, options.nativeVersion)
    const packageVersion = await readPackageVersion(options.cwd)
    const { bundleId, bundleIdSource } = resolveBundleId({
      bundleId: options.bundleId,
      bundleFromPackage: options.bundleFromPackage,
      packageVersion,
      nativeVersion,
      hash,
    })

    const manifest: ExpoBundleManifest = {
      target: 'expo',
      hash,
      nativeVersion,
      runtimeVersion,
      bundleId,
      launchAsset: assets.launchAsset,
      assets: assets.assets,
      createdAt: new Date().toISOString(),
      platform: options.platform,
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
