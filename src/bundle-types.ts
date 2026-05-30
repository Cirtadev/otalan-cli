import type { MobilePlatform, Target } from './config'

type BundleBaseManifest = {
  target: Target
  hash: string
  runtimeVersion: string
  bundleId: string
  createdAt: string
  platform: MobilePlatform
}

export type JsonObject = Record<string, unknown>

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

export type BundleOptions = {
  cwd: string
  outputDir: string
  bundleId?: string
  bundleFromPackage?: boolean
  explicitBundleIdSource?: Extract<BundleIdSource, 'flag' | 'prompt'>
  runtimeVersion?: string
  inputDir?: string
  platform: MobilePlatform
  target: Target
  verbose?: boolean
  beforeWrite?: (manifest: BundleManifest) => Promise<void>
}

export type BundleResult = {
  outputDir: string
  archiveFileName: string
  manifest: BundleManifest
  bundleIdSource: BundleIdSource
  omittedSourceMapCount: number
}

export type CollectDirectoryEntriesOptions = {
  shouldOmitFile?: (relativePath: string) => boolean
  omittedPaths?: string[]
}

export type ZipDirectoryResult = {
  bytes: Uint8Array
  omittedSourceMapCount: number
}

export const LEGACY_BUNDLE_ARCHIVE_FILE_NAME = 'bundle.zip'
