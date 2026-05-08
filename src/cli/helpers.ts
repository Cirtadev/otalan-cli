import path from 'node:path'

import {
  PROJECT_CONFIG_FILE,
  loadGlobalConfig,
  loadProjectConfig,
  type MobilePlatform,
  type Target,
} from '../config'
import type { BundleManifest } from '../bundle'
import { readStringOption } from './args'
import { getReleaseContext } from '../http'

export type CommandContext = {
  cwd: string
}

export type BundleArchive = {
  fileName: string
  fileSizeBytes: number
  contentType: string
  body: Blob
}

const BUNDLE_ARCHIVE_FILE_NAME = 'bundle.zip'

export function resolveApiKeysUrl() {
  return 'https://otalan.com/api-keys'
}

export async function resolveApiConfig(options: Record<string, string | boolean>) {
  const stored = await loadGlobalConfig().catch(() => null)
  const apiKey = readStringOption(options, 'api-key') ?? stored?.apiKey
  const apiUrl = readStringOption(options, 'api-url') ?? stored?.apiUrl ?? 'https://api.otalan.com'

  if (!apiKey) {
    throw new Error('No API key configured. Run `otalan login` first or pass --api-key.')
  }

  return {
    apiKey,
    apiUrl,
  }
}

export async function assertReleaseContextMatchesConfig(input: {
  apiUrl: string
  apiKey: string
  organizationSlug?: string
  projectSlug?: string
}) {
  const context = await getReleaseContext({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
  })

  if (input.organizationSlug && input.organizationSlug !== context.organizationSlug) {
    throw new Error(
      `Configured organization slug "${input.organizationSlug}" does not match CI key organization "${context.organizationSlug}".`,
    )
  }

  if (input.projectSlug && input.projectSlug !== context.projectSlug) {
    throw new Error(
      `Configured project slug "${input.projectSlug}" does not match CI key project "${context.projectSlug}".`,
    )
  }

  return context
}

export async function resolveProject(context: CommandContext) {
  return loadProjectConfig(context.cwd).catch(() => {
    throw new Error(`Missing ${PROJECT_CONFIG_FILE}. Run \`otalan init\` in this project first.`)
  })
}

export function resolveTarget(
  options: Record<string, string | boolean>,
  fallback?: Target,
): Target {
  const target = readStringOption(options, 'target') ?? fallback

  if (target === 'capacitor' || target === 'expo') {
    return target
  }

  throw new Error('Target is required. Use --target capacitor or --target expo.')
}

export function resolvePlatform(
  options: Record<string, string | boolean>,
  fallback?: MobilePlatform,
): MobilePlatform {
  const platform = readStringOption(options, 'platform') ?? fallback

  if (platform === 'ios' || platform === 'android') {
    return platform
  }

  throw new Error('Platform is required. Use --platform ios or --platform android.')
}

export function resolveManifestPlatform(manifest: BundleManifest, optionPlatform?: string) {
  if (optionPlatform && manifest.platform && optionPlatform !== manifest.platform) {
    throw new Error(`Bundle manifest platform "${manifest.platform}" does not match --platform "${optionPlatform}".`)
  }

  if (manifest.platform) {
    return manifest.platform
  }

  if (optionPlatform === 'ios' || optionPlatform === 'android') {
    return optionPlatform
  }

  throw new Error('Bundle manifest is missing platform. Rebuild the bundle or pass --platform.')
}

function resolveManifestReleaseNativeVersion(manifest: BundleManifest) {
  return manifest.target === 'expo'
    ? manifest.runtimeVersion
    : manifest.nativeVersion
}

function resolveManifestReleaseNativeVersionField(manifest: BundleManifest) {
  return manifest.target === 'expo' ? 'runtimeVersion' : 'nativeVersion'
}

export function resolveManifestNativeVersion(manifest: BundleManifest, optionNativeVersion?: string) {
  const manifestNativeVersion = resolveManifestReleaseNativeVersion(manifest)
  const manifestNativeVersionField = resolveManifestReleaseNativeVersionField(manifest)

  if (optionNativeVersion && manifestNativeVersion && optionNativeVersion !== manifestNativeVersion) {
    throw new Error(`Bundle manifest ${manifestNativeVersionField} "${manifestNativeVersion}" does not match --native-version "${optionNativeVersion}".`)
  }

  if (manifestNativeVersion) {
    return manifestNativeVersion
  }

  if (optionNativeVersion) {
    return optionNativeVersion
  }

  throw new Error(`Bundle manifest is missing ${manifestNativeVersionField}. Rebuild the bundle or pass --native-version.`)
}

export async function readBundleManifest(outputDir: string) {
  const raw = JSON.parse(
    await Bun.file(path.join(outputDir, 'manifest.json')).text(),
  ) as BundleManifest

  return raw
}

export async function readBundleManifestIfExists(outputDir: string) {
  const manifestPath = path.join(outputDir, 'manifest.json')

  if (!(await Bun.file(manifestPath).exists())) {
    return null
  }

  return readBundleManifest(outputDir)
}

export function resolveManifestDefaultNativeVersion(manifest: BundleManifest | null, platform: MobilePlatform) {
  if (!manifest) {
    return undefined
  }

  if (manifest.platform !== platform) {
    return undefined
  }

  return resolveManifestReleaseNativeVersion(manifest)
}

export async function openBundleArchive(outputDir: string): Promise<BundleArchive> {
  const archivePath = path.join(outputDir, BUNDLE_ARCHIVE_FILE_NAME)
  const body = Bun.file(archivePath)

  if (!(await body.exists())) {
    throw new Error(`Missing bundle archive at ${archivePath}. Rebuild the bundle before publishing.`)
  }

  if (body.size === 0) {
    throw new Error(`Bundle archive at ${archivePath} is empty. Rebuild the bundle before publishing.`)
  }

  return {
    fileName: BUNDLE_ARCHIVE_FILE_NAME,
    fileSizeBytes: body.size,
    contentType: 'application/zip',
    body,
  }
}
