import type { BundleIdSource } from './bundle-types'

export function normalizeBundleId(seed: string) {
  const normalizedSeed = seed
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'bundle'

  return normalizedSeed
}

export function createBundleArchiveFileName(bundleId: string) {
  return `bundle-${normalizeBundleId(bundleId)}.zip`
}

export function createAutoBundleId(seed: string, hash: string) {
  return `${normalizeBundleId(seed)}-${hash.slice(0, 12)}`
}

export function resolveBundleId(input: {
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

export function formatOmittedSourceMapCount(count: number) {
  return count === 1
    ? 'Omitted 1 source map file from bundle ZIP.'
    : `Omitted ${count} source map files from bundle ZIP.`
}
