import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { zipSync } from 'fflate'

import { assertNoNativeBundleEntries, findNativeBundleEntries } from './bundle-validation'
import type { MobilePlatform, Target } from './config'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type BundleBaseManifest = {
  target: Target
  hash: string
  runtimeVersion: string
  bundleId: string
  createdAt: string
  platform: MobilePlatform
}

type JsonObject = Record<string, unknown>

export type CapacitorBundleManifest = BundleBaseManifest & {
  target: 'capacitor'
}

export type ExpoBundleManifest = BundleBaseManifest & {
  target: 'expo'
  launchAsset: string
  assets: string[]
  expoConfig: JsonObject
}

export type BundleManifest = CapacitorBundleManifest | ExpoBundleManifest
export type BundleIdSource = 'flag' | 'prompt' | 'runtime-version' | 'package-json'

type BundleOptions = {
  cwd: string
  outputDir: string
  bundleId?: string
  bundleFromPackage?: boolean
  explicitBundleIdSource?: Extract<BundleIdSource, 'flag' | 'prompt'>
  runtimeVersion?: string
  inputDir?: string
  platform: MobilePlatform
  target: Target
  beforeWrite?: (manifest: BundleManifest) => Promise<void>
}

type BundleResult = {
  outputDir: string
  manifest: BundleManifest
  bundleIdSource: BundleIdSource
  omittedSourceMapCount: number
}

type CollectDirectoryEntriesOptions = {
  shouldOmitFile?: (relativePath: string) => boolean
  omittedPaths?: string[]
}

type ZipDirectoryResult = {
  bytes: Uint8Array
  omittedSourceMapCount: number
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

async function collectDirectoryEntries(
  rootDir: string,
  currentDir = rootDir,
  options: CollectDirectoryEntriesOptions = {},
) {
  const entries: Record<string, Uint8Array> = {}
  const items = (await readdir(currentDir, { withFileTypes: true }))
    .sort((left, right) => {
      if (left.name < right.name) {
        return -1
      }

      if (left.name > right.name) {
        return 1
      }

      return 0
    })

  for (const item of items) {
    const absolutePath = path.join(currentDir, item.name)

    if (item.isDirectory()) {
      const nestedEntries = await collectDirectoryEntries(rootDir, absolutePath, options)

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

    if (options.shouldOmitFile?.(relativePath)) {
      options.omittedPaths?.push(relativePath)
      continue
    }

    entries[relativePath] = new Uint8Array(await Bun.file(absolutePath).arrayBuffer())
  }

  return entries
}

function isSourceMapPath(relativePath: string) {
  return relativePath.endsWith('.map')
}

export function formatOmittedSourceMapCount(count: number) {
  return count === 1
    ? 'Omitted 1 source map file from bundle ZIP.'
    : `Omitted ${count} source map files from bundle ZIP.`
}

async function zipDirectory(directoryPath: string): Promise<ZipDirectoryResult> {
  const omittedSourceMapPaths: string[] = []
  const entries = await collectDirectoryEntries(directoryPath, directoryPath, {
    shouldOmitFile: isSourceMapPath,
    omittedPaths: omittedSourceMapPaths,
  })

  if (Object.keys(entries).length === 0) {
    if (omittedSourceMapPaths.length > 0) {
      throw new Error(`No bundle files found in ${directoryPath} after omitting ${omittedSourceMapPaths.length} source map file(s).`)
    }

    throw new Error(`No files found in ${directoryPath}`)
  }

  assertNoNativeBundleEntries(directoryPath, Object.keys(entries))

  return {
    bytes: zipSync(entries, { level: 9 }),
    omittedSourceMapCount: omittedSourceMapPaths.length,
  }
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

type ExpoConfig = JsonObject & {
  runtimeVersion?: ExpoRuntimeVersionConfig
  sdkVersion?: string
  version?: string
  ios?: JsonObject & {
    version?: string
    buildNumber?: string
    runtimeVersion?: ExpoRuntimeVersionConfig
  }
  android?: JsonObject & {
    version?: string
    versionCode?: string | number
    runtimeVersion?: ExpoRuntimeVersionConfig
  }
}

type ExpoRuntimeVersionConfig = string | {
  policy?: string
}

// -----------------------------------------------------------------------------
// Expo config helpers
// -----------------------------------------------------------------------------

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

  const parsed = JSON.parse(output) as ExpoConfig & {
    exp?: ExpoConfig
    expo?: ExpoConfig
  }

  return parsed.exp ?? parsed.expo ?? parsed
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function resolveExpoConfiguredVersion(config: ExpoConfig, platform: MobilePlatform) {
  return normalizeOptionalString(
    platform === 'ios'
      ? config.ios?.version ?? config.version
      : config.android?.version ?? config.version,
  )
}

function resolveExpoRuntimeVersionPolicy(
  config: ExpoConfig,
  platform: MobilePlatform,
  policy: string,
) {
  const appVersion = resolveExpoConfiguredVersion(config, platform)

  switch (policy) {
    case 'appVersion': {
      if (!appVersion) {
        throw new Error('Unable to resolve Expo runtimeVersion policy "appVersion". Set version in Expo config or pass --runtime-version.')
      }

      return appVersion
    }
    case 'sdkVersion': {
      const sdkVersion = normalizeOptionalString(config.sdkVersion)

      if (!sdkVersion) {
        throw new Error('Unable to resolve Expo runtimeVersion policy "sdkVersion". Set sdkVersion in Expo config or pass --runtime-version.')
      }

      return `exposdk:${sdkVersion}`
    }
    default:
      throw new Error(`Unable to resolve Expo runtimeVersion policy "${policy}". Pass --runtime-version or use a resolved Expo runtimeVersion.`)
  }
}

function findRuntimeVersionInObject(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = findRuntimeVersionInObject(item)

      if (resolved) {
        return resolved
      }
    }

    return undefined
  }

  const record = value as Record<string, unknown>
  const runtimeVersion = normalizeOptionalString(record.runtimeVersion)

  if (runtimeVersion) {
    return runtimeVersion
  }

  for (const nestedValue of Object.values(record)) {
    const resolved = findRuntimeVersionInObject(nestedValue)

    if (resolved) {
      return resolved
    }
  }

  return undefined
}

async function readExpoExportRuntimeVersion(exportDir: string) {
  const metadataPath = path.join(exportDir, 'metadata.json')
  const contents = await readTextFileIfExists(metadataPath)

  if (!contents) {
    return undefined
  }

  try {
    return findRuntimeVersionInObject(JSON.parse(contents) as unknown)
  } catch {
    return undefined
  }
}

function resolveExpoRuntimeVersion(
  config: ExpoConfig,
  platform: MobilePlatform,
  runtimeVersion?: string,
  exportedRuntimeVersion?: string,
  fallbackRuntimeVersion?: string,
) {
  if (runtimeVersion?.trim()) {
    return runtimeVersion.trim()
  }

  if (exportedRuntimeVersion?.trim()) {
    return exportedRuntimeVersion.trim()
  }

  const resolved = platform === 'ios'
    ? config.ios?.runtimeVersion ?? config.runtimeVersion
    : config.android?.runtimeVersion ?? config.runtimeVersion

  if (typeof resolved === 'string' && resolved.trim()) {
    return resolved.trim()
  }

  if (resolved && typeof resolved === 'object') {
    const policy = normalizeOptionalString(resolved.policy)

    if (policy === 'fingerprint') {
      throw new Error('Unable to resolve Expo runtimeVersion policy "fingerprint" from export metadata. Pass --runtime-version if your Expo export omits metadata.json.')
    }

    if (policy) {
      return resolveExpoRuntimeVersionPolicy(config, platform, policy)
    }
  }

  if (fallbackRuntimeVersion?.trim()) {
    return fallbackRuntimeVersion.trim()
  }

  throw new Error('Expo runtimeVersion is required. Pass --runtime-version or set runtimeVersion in Expo config.')
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

  throw new Error(`Unable to resolve iOS runtime version placeholder "${value}". Pass --runtime-version or ensure ${buildSettingReference} is defined in the Xcode project.`)
}

async function resolveIosRuntimeVersion(cwd: string, runtimeVersion?: string) {
  if (runtimeVersion) {
    return runtimeVersion
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

  throw new Error('Unable to resolve iOS runtime version. Pass --runtime-version or ensure Info.plist defines CFBundleShortVersionString.')
}

async function resolveAndroidRuntimeVersion(cwd: string, runtimeVersion?: string) {
  if (runtimeVersion) {
    return runtimeVersion
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

  throw new Error('Unable to resolve Android runtime version. Pass --runtime-version or ensure build.gradle defines versionName as a string literal.')
}

async function resolveCapacitorRuntimeVersion(
  cwd: string,
  platform: MobilePlatform,
  runtimeVersion?: string,
) {
  if (platform === 'ios') {
    return resolveIosRuntimeVersion(cwd, runtimeVersion)
  }

  return resolveAndroidRuntimeVersion(cwd, runtimeVersion)
}

export async function resolveProjectRuntimeVersion(
  cwd: string,
  platform: MobilePlatform,
  runtimeVersion?: string,
) {
  if (runtimeVersion) {
    return runtimeVersion
  }

  const runtimeResolver = platform === 'ios'
    ? resolveIosRuntimeVersion
    : resolveAndroidRuntimeVersion
  const nativeRuntimeVersion = await runtimeResolver(cwd).catch(() => null)

  if (nativeRuntimeVersion) {
    return nativeRuntimeVersion
  }

  const expoConfig = await readExpoConfig(cwd).catch(() => null)

  if (expoConfig) {
    const expoRuntimeVersion = resolveExpoRuntimeVersion(
      expoConfig,
      platform,
      undefined,
      undefined,
      resolveExpoConfiguredVersion(expoConfig, platform),
    )

    if (expoRuntimeVersion) {
      return expoRuntimeVersion
    }
  }

  throw new Error(`Unable to resolve ${platform} runtime version. Pass --runtime-version to override.`)
}

function resolveBundleId(input: {
  bundleId?: string
  bundleFromPackage?: boolean
  explicitBundleIdSource?: Extract<BundleIdSource, 'flag' | 'prompt'>
  packageVersion?: string
  runtimeVersion: string
  hash: string
}) {
  if (input.bundleId) {
    return {
      bundleId: normalizeBundleId(input.bundleId),
      bundleIdSource: input.explicitBundleIdSource ?? 'flag',
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
    bundleId: createAutoBundleId(input.runtimeVersion, input.hash),
    bundleIdSource: 'runtime-version' as const,
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

async function createExpoExportDirectory(cwd: string) {
  const otalanDir = path.join(cwd, '.otalan')

  await mkdir(otalanDir, { recursive: true })

  return mkdtemp(path.join(otalanDir, 'expo-export-'))
}

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

export const bundleTestUtils = {
  normalizeBundleId,
  createAutoBundleId,
  resolveBundleId,
  resolveExpoRuntimeVersion,
  findRuntimeVersionInObject,
  collectDirectoryEntries,
  createExpoExportDirectory,
  findNativeBundleEntries,
  formatOmittedSourceMapCount,
  zipDirectory,
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
  await writeBundleOutput(options.outputDir, bundleArchive.bytes, manifest)

  return {
    outputDir: options.outputDir,
    manifest,
    bundleIdSource,
    omittedSourceMapCount: bundleArchive.omittedSourceMapCount,
  }
}

async function bundleExpoProject(options: BundleOptions): Promise<BundleResult> {
  const exportDir = await createExpoExportDirectory(options.cwd)

  try {
    await runCommand(
      'bunx',
      ['expo', 'export', '--platform', options.platform, '--output-dir', exportDir],
      options.cwd,
    )

    const exportedRuntimeVersion = await readExpoExportRuntimeVersion(exportDir)
    const expoConfig = await readExpoConfig(options.cwd)
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
    await writeBundleOutput(options.outputDir, bundleArchive.bytes, manifest)

    return {
      outputDir: options.outputDir,
      manifest,
      bundleIdSource,
      omittedSourceMapCount: bundleArchive.omittedSourceMapCount,
    }
  } finally {
    await rm(exportDir, { recursive: true, force: true })
  }
}
