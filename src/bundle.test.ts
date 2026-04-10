import { describe, expect, test } from 'bun:test'

import { bundleTestUtils } from './bundle'

// -----------------------------------------------------------------------------
// bundle IDs
// -----------------------------------------------------------------------------

describe('bundleTestUtils.normalizeBundleId', () => {
  test('normalizes non URL-safe characters into hyphens', () => {
    expect(bundleTestUtils.normalizeBundleId('  release 1/ios  ')).toBe('release-1-ios')
  })

  test('falls back to "bundle" when the seed contains no valid characters', () => {
    expect(bundleTestUtils.normalizeBundleId('***')).toBe('bundle')
  })
})

describe('bundleTestUtils.resolveBundleId', () => {
  test('prefers an explicit bundle ID', () => {
    expect(bundleTestUtils.resolveBundleId({
      bundleId: '  1.0.5 beta ',
      bundleFromPackage: true,
      packageVersion: '2.0.0',
      nativeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '1.0.5-beta',
      bundleIdSource: 'flag',
    })
  })

  test('uses package.json when requested', () => {
    expect(bundleTestUtils.resolveBundleId({
      bundleFromPackage: true,
      packageVersion: '2.0.0',
      nativeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '2.0.0',
      bundleIdSource: 'package-json',
    })
  })

  test('generates an auto bundle ID from nativeVersion and hash by default', () => {
    expect(bundleTestUtils.resolveBundleId({
      nativeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '3.0.0-abcdef123456',
      bundleIdSource: 'native-version',
    })
  })
})

// -----------------------------------------------------------------------------
// Expo helpers
// -----------------------------------------------------------------------------

describe('bundleTestUtils.resolveExpoNativeVersion', () => {
  test('prefers an explicit native version override', () => {
    expect(bundleTestUtils.resolveExpoNativeVersion({
      version: '1.0.0',
      ios: {
        version: '1.0.1',
      },
    }, 'ios', '9.9.9')).toBe('9.9.9')
  })

  test('uses platform-specific values before falling back to top-level version', () => {
    expect(bundleTestUtils.resolveExpoNativeVersion({
      version: '1.0.0',
      ios: {
        version: '1.0.1',
      },
    }, 'ios')).toBe('1.0.1')

    expect(bundleTestUtils.resolveExpoNativeVersion({
      version: '1.0.0',
    }, 'android')).toBe('1.0.0')
  })
})

describe('bundleTestUtils.resolveExpoRuntimeVersion', () => {
  test('prefers an explicit runtimeVersion override', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      runtimeVersion: '1.0.0',
    }, 'ios', '9.9.9', undefined)).toBe('9.9.9')
  })

  test('uses the exported runtimeVersion when present', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      runtimeVersion: '1.0.0',
    }, 'ios', undefined, '2.0.0')).toBe('2.0.0')
  })

  test('resolves runtimeVersion policies from Expo config', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      version: '1.2.3',
      runtimeVersion: {
        policy: 'appVersion',
      },
    }, 'ios')).toBe('1.2.3')

    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      sdkVersion: '52.0.0',
      runtimeVersion: {
        policy: 'sdkVersion',
      },
    }, 'android')).toBe('exposdk:52.0.0')

    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      version: '1.2.3',
      ios: {
        buildNumber: '45',
        runtimeVersion: {
          policy: 'nativeVersion',
        },
      },
    }, 'ios')).toBe('1.2.3(45)')
  })
})

describe('bundleTestUtils.findRuntimeVersionInObject', () => {
  test('recursively finds the first nested runtimeVersion string', () => {
    expect(bundleTestUtils.findRuntimeVersionInObject({
      metadata: {
        nested: [
          {
            runtimeVersion: '3.4.5',
          },
        ],
      },
    })).toBe('3.4.5')
  })
})
