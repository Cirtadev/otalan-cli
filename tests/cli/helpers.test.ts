import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { BundleManifest } from '../../src/bundle'
import {
  openBundleArchive,
  resolveApiKeysUrl,
  resolveManifestDefaultNativeVersion,
  resolveManifestNativeVersion,
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
  nativeVersion: '1.0.0',
  bundleId: '1.0.0-abc123',
  createdAt: '2026-04-10T00:00:00.000Z',
  platform: 'ios',
}

const expoManifest: BundleManifest = {
  target: 'expo',
  hash: 'def456',
  nativeVersion: '2.0.0',
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

  test('returns the manifest native version when it matches the option', () => {
    expect(resolveManifestNativeVersion(capacitorManifest, '1.0.0')).toBe('1.0.0')
  })

  test('uses the Expo runtimeVersion as the release nativeVersion', () => {
    expect(resolveManifestNativeVersion(expoManifest, '1.0.0')).toBe('1.0.0')
    expect(resolveManifestDefaultNativeVersion(expoManifest, 'ios')).toBe('1.0.0')
  })

  test('throws when the manifest native version conflicts with the option', () => {
    expect(() => resolveManifestNativeVersion(capacitorManifest, '2.0.0')).toThrow(
      'Bundle manifest nativeVersion "1.0.0" does not match --native-version "2.0.0".',
    )
  })

  test('throws when the Expo manifest runtimeVersion conflicts with the option', () => {
    expect(() => resolveManifestNativeVersion(expoManifest, '2.0.0')).toThrow(
      'Bundle manifest runtimeVersion "1.0.0" does not match --native-version "2.0.0".',
    )
  })

  test('only uses the manifest native version as a default when the platform matches', () => {
    expect(resolveManifestDefaultNativeVersion(capacitorManifest, 'ios')).toBe('1.0.0')
    expect(resolveManifestDefaultNativeVersion(capacitorManifest, 'android')).toBeUndefined()
  })
})

describe('resolveApiKeysUrl', () => {
  test('uses the public dashboard URL', () => {
    expect(resolveApiKeysUrl()).toBe('https://otalan.com/api-keys')
  })
})

describe('openBundleArchive', () => {
  test('returns a disk-backed archive body without wrapping bytes in File', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-archive-'))
    const outputDir = path.join(cwd, '.otalan', 'bundle')

    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(outputDir, 'bundle.zip'), 'zip-bytes')

    const archive = await openBundleArchive(outputDir)

    expect(archive.fileName).toBe('bundle.zip')
    expect(archive.fileSizeBytes).toBe(9)
    expect(archive.contentType).toBe('application/zip')
    expect(archive.body).toBeInstanceOf(Blob)
    expect(archive.body).not.toBeInstanceOf(File)
    expect(await archive.body.text()).toBe('zip-bytes')
  })
})
