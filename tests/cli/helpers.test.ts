import { describe, expect, test } from 'bun:test'

import type { BundleManifest } from '../../src/bundle'
import {
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

  test('throws when the manifest native version conflicts with the option', () => {
    expect(() => resolveManifestNativeVersion(capacitorManifest, '2.0.0')).toThrow(
      'Bundle manifest nativeVersion "1.0.0" does not match --native-version "2.0.0".',
    )
  })

  test('only uses the manifest native version as a default when the platform matches', () => {
    expect(resolveManifestDefaultNativeVersion(capacitorManifest, 'ios')).toBe('1.0.0')
    expect(resolveManifestDefaultNativeVersion(capacitorManifest, 'android')).toBeUndefined()
  })
})

describe('resolveApiKeysUrl', () => {
  test('maps localhost API URLs to the local dashboard URL', () => {
    expect(resolveApiKeysUrl('http://localhost:8787')).toBe('http://localhost:4000/api-keys')
    expect(resolveApiKeysUrl('http://127.0.0.1:8787')).toBe('http://localhost:4000/api-keys')
  })

  test('falls back to the production dashboard URL for remote or invalid values', () => {
    expect(resolveApiKeysUrl('https://api.otalan.com')).toBe('https://otalan.com/api-keys')
    expect(resolveApiKeysUrl('not-a-url')).toBe('https://otalan.com/api-keys')
  })
})
