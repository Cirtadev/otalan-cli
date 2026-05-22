import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { BundleManifest } from '../../src/bundle'
import {
  openBundleArchive,
  resolveApiKeysUrl,
  resolveManifestDefaultRuntimeVersion,
  resolveManifestRuntimeVersion,
  resolveManifestPlatform,
  resolvePlatform,
  resolveTarget,
} from '../../src/cli/helpers'

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const capacitorManifest: BundleManifest = {
  target: 'capacitor',
  hash: 'abc123',
  runtimeVersion: '1.0.0',
  bundleId: '1.0.0-abc123',
  createdAt: '2026-04-10T00:00:00.000Z',
  platform: 'ios',
}

const expoManifest: BundleManifest = {
  target: 'expo',
  hash: 'def456',
  runtimeVersion: '1.0.0',
  bundleId: '1.0.0-def456',
  launchAsset: '_expo/static/js/ios/entry.hbc',
  assets: ['assets/icon.png'],
  expoConfig: {
    scheme: 'example',
  },
  createdAt: '2026-04-10T00:00:00.000Z',
  platform: 'ios',
}

// -----------------------------------------------------------------------------
// helper resolution
// -----------------------------------------------------------------------------

describe('resolveTarget', () => {
  test('uses the explicit option when provided', () => {
    expect(resolveTarget({ target: 'expo' }, 'capacitor')).toBe('expo')
  })

  test('falls back when no explicit target is provided', () => {
    expect(resolveTarget({}, 'capacitor')).toBe('capacitor')
  })

  test('throws for unsupported targets', () => {
    expect(() => resolveTarget({ target: 'cordova' }, undefined)).toThrow(
      'Target is required. Use --target capacitor or --target expo.',
    )
  })
})

describe('resolvePlatform', () => {
  test('uses the explicit option when provided', () => {
    expect(resolvePlatform({ platform: 'android' }, 'ios')).toBe('android')
  })

  test('falls back when no explicit platform is provided', () => {
    expect(resolvePlatform({}, 'ios')).toBe('ios')
  })

  test('throws for unsupported platforms', () => {
    expect(() => resolvePlatform({ platform: 'web' }, undefined)).toThrow(
      'Platform is required. Use --platform ios or --platform android.',
    )
  })
})

describe('manifest tuple helpers', () => {
  test('returns the manifest platform when it matches the option', () => {
    expect(resolveManifestPlatform(capacitorManifest, 'ios')).toBe('ios')
  })

  test('throws when the manifest platform conflicts with the option', () => {
    expect(() => resolveManifestPlatform(capacitorManifest, 'android')).toThrow(
      'Bundle manifest platform "ios" does not match --platform "android".',
    )
  })

  test('returns the manifest runtime version when it matches the option', () => {
    expect(resolveManifestRuntimeVersion(capacitorManifest, '1.0.0')).toBe('1.0.0')
  })

  test('uses the Expo runtimeVersion as the release runtimeVersion', () => {
    expect(resolveManifestRuntimeVersion(expoManifest, '1.0.0')).toBe('1.0.0')
    expect(resolveManifestDefaultRuntimeVersion(expoManifest, 'ios')).toBe('1.0.0')
  })

  test('throws when the manifest runtime version conflicts with the option', () => {
    expect(() => resolveManifestRuntimeVersion(capacitorManifest, '2.0.0')).toThrow(
      'Bundle manifest runtimeVersion "1.0.0" does not match --runtime-version "2.0.0".',
    )
  })

  test('throws when the Expo manifest runtimeVersion conflicts with the option', () => {
    expect(() => resolveManifestRuntimeVersion(expoManifest, '2.0.0')).toThrow(
      'Bundle manifest runtimeVersion "1.0.0" does not match --runtime-version "2.0.0".',
    )
  })

  test('rejects manifests without runtimeVersion', () => {
    const legacyManifest = {
      target: 'capacitor',
      hash: 'abc123',
      bundleId: '1.0.0-abc123',
      createdAt: '2026-04-10T00:00:00.000Z',
      platform: 'ios',
    } as unknown as BundleManifest

    expect(() => resolveManifestRuntimeVersion(legacyManifest, '1.0.0')).toThrow(
      'Bundle manifest is missing runtimeVersion. Rebuild the bundle.',
    )
  })

  test('only uses the manifest runtime version as a default when the platform matches', () => {
    expect(resolveManifestDefaultRuntimeVersion(capacitorManifest, 'ios')).toBe('1.0.0')
    expect(resolveManifestDefaultRuntimeVersion(capacitorManifest, 'android')).toBeUndefined()
  })
})

describe('resolveApiKeysUrl', () => {
  test('uses the public dashboard URL', () => {
    expect(resolveApiKeysUrl()).toBe('https://otalan.com/api-keys')
  })

  test('derives self-hosted dashboard URLs from the configured API URL', () => {
    expect(resolveApiKeysUrl('https://api.staging.example.com/v1')).toBe('https://staging.example.com/api-keys')
    expect(resolveApiKeysUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api-keys')
  })
})

describe('openBundleArchive', () => {
  test('opens the bundle-ID suffixed archive body without wrapping bytes in File', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-archive-'))
    const outputDir = path.join(cwd, '.otalan', 'bundle')

    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(outputDir, 'bundle-1.0.0-abc123.zip'), 'zip-bytes')
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(capacitorManifest, null, 2)}\n`)

    const archive = await openBundleArchive(outputDir)

    expect(archive.fileName).toBe('bundle-1.0.0-abc123.zip')
    expect(archive.fileSizeBytes).toBe(9)
    expect(archive.contentType).toBe('application/zip')
    expect(archive.body).toBeInstanceOf(Blob)
    expect(archive.body).not.toBeInstanceOf(File)
    expect(await archive.body.text()).toBe('zip-bytes')
  })

  test('falls back to legacy bundle.zip output', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-archive-'))
    const outputDir = path.join(cwd, '.otalan', 'bundle')

    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(outputDir, 'bundle.zip'), 'zip-bytes')
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(capacitorManifest, null, 2)}\n`)

    const archive = await openBundleArchive(outputDir)

    expect(archive.fileName).toBe('bundle.zip')
    expect(await archive.body.text()).toBe('zip-bytes')
  })

  test('prefers the manifest bundle archive when both current and legacy files exist', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-archive-'))
    const outputDir = path.join(cwd, '.otalan', 'bundle')

    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(outputDir, 'bundle-1.0.0-abc123.zip'), 'current-zip-bytes')
    await writeFile(path.join(outputDir, 'bundle.zip'), 'legacy-zip-bytes')
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(capacitorManifest, null, 2)}\n`)

    const archive = await openBundleArchive(outputDir)

    expect(archive.fileName).toBe('bundle-1.0.0-abc123.zip')
    expect(await archive.body.text()).toBe('current-zip-bytes')
  })

  test('uses the normalized manifest bundle ID when opening the archive', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-archive-'))
    const outputDir = path.join(cwd, '.otalan', 'bundle')
    const manifest: BundleManifest = {
      ...capacitorManifest,
      bundleId: 'release @ ios:beta',
    }

    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(outputDir, 'bundle-release-ios-beta.zip'), 'zip-bytes')
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    const archive = await openBundleArchive(outputDir)

    expect(archive.fileName).toBe('bundle-release-ios-beta.zip')
    expect(await archive.body.text()).toBe('zip-bytes')
  })
})
