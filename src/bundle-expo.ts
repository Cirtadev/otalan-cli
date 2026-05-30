import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'

import type { MobilePlatform } from './config'
import type { JsonObject } from './bundle-types'
import {
  collectDirectoryEntries,
  readTextFileIfExists,
} from './bundle-files'

const MAX_RUNTIME_VERSION_SEARCH_DEPTH = 32

type ExpoRuntimeVersionConfig = string | {
  policy?: string
}

export type ExpoConfig = JsonObject & {
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

export async function assertLocalExpoCliAvailable(cwd: string) {
  const candidates = [
    path.join(cwd, 'node_modules', '.bin', 'expo'),
    path.join(cwd, 'node_modules', '.bin', 'expo.cmd'),
    path.join(cwd, 'node_modules', 'expo', 'package.json'),
  ]

  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      return
    }
  }

  throw new Error('Expo CLI is required for Expo bundles. Install the project dependencies before running `otalan bundle --target expo`.')
}

type ExpoCommandOptions = {
  verbose?: boolean
}

async function readProcessStream(stream: ReadableStream<Uint8Array> | null | undefined) {
  return stream ? await new Response(stream).text() : ''
}

function formatProcessFailure(command: string, exitCode: number, output: string) {
  const trimmedOutput = output.trim()

  if (!trimmedOutput) {
    return `${command} exited with code ${exitCode}`
  }

  return `${command} exited with code ${exitCode}\n\n${trimmedOutput}`
}

export async function readExpoConfig(cwd: string, options: ExpoCommandOptions = {}): Promise<ExpoConfig> {
  await assertLocalExpoCliAvailable(cwd)

  const proc = Bun.spawn(['bunx', 'expo', 'config', '--json'], {
    cwd,
    stdout: 'pipe',
    stderr: options.verbose ? 'inherit' : 'pipe',
  })
  const stderrPromise = options.verbose
    ? Promise.resolve('')
    : readProcessStream(proc.stderr)
  const [exitCode, stderrText] = await Promise.all([
    proc.exited,
    stderrPromise,
  ])

  if (exitCode !== 0) {
    throw new Error(formatProcessFailure('bunx expo config --json', exitCode, stderrText))
  }

  const output = await new Response(proc.stdout).text()

  const parsed = JSON.parse(output) as ExpoConfig & {
    exp?: ExpoConfig
    expo?: ExpoConfig
  }

  return parsed.exp ?? parsed.expo ?? parsed
}

export function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export function resolveExpoConfiguredVersion(config: ExpoConfig, platform: MobilePlatform) {
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

export function findRuntimeVersionInObject(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  if (depth > MAX_RUNTIME_VERSION_SEARCH_DEPTH) {
    return undefined
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = findRuntimeVersionInObject(item, depth + 1)

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
    const resolved = findRuntimeVersionInObject(nestedValue, depth + 1)

    if (resolved) {
      return resolved
    }
  }

  return undefined
}

function findKnownExpoMetadataRuntimeVersion(value: unknown, platform: MobilePlatform) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const metadata = value as Record<string, unknown>
  const runtimeVersion = normalizeOptionalString(metadata.runtimeVersion)

  if (runtimeVersion) {
    return runtimeVersion
  }

  const platforms = metadata.platforms

  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    return undefined
  }

  const platformMetadata = (platforms as Record<string, unknown>)[platform]

  if (!platformMetadata || typeof platformMetadata !== 'object' || Array.isArray(platformMetadata)) {
    return undefined
  }

  return normalizeOptionalString((platformMetadata as Record<string, unknown>).runtimeVersion)
}

export async function readExpoExportRuntimeVersion(exportDir: string, platform: MobilePlatform) {
  const metadataPath = path.join(exportDir, 'metadata.json')
  const contents = await readTextFileIfExists(metadataPath)

  if (!contents) {
    return undefined
  }

  try {
    const metadata = JSON.parse(contents) as unknown
    return findKnownExpoMetadataRuntimeVersion(metadata, platform)
      ?? findRuntimeVersionInObject(metadata)
  } catch {
    return undefined
  }
}

export function resolveExpoRuntimeVersion(
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

export async function buildExpoAssetManifest(exportDir: string) {
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

export async function createExpoExportDirectory(cwd: string) {
  const otalanDir = path.join(cwd, '.otalan')

  await mkdir(otalanDir, { recursive: true })

  return mkdtemp(path.join(otalanDir, 'expo-export-'))
}
