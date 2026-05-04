import { describe, expect, test } from 'bun:test'

import { bundleCommandTestUtils } from '../../src/commands/bundle'
import type { BundleManifest } from '../../src/bundle'
import type { ReleaseItem } from '../../src/http'

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const MANIFEST = {
  target: 'capacitor',
  hash: 'abc123',
  nativeVersion: '1.2.3',
  bundleId: '1.2.3-web.4',
  createdAt: '2026-05-04T00:00:00.000Z',
  platform: 'ios',
} as const satisfies BundleManifest

function createRelease(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    id: 'release-123',
    projectId: 'project-123',
    appId: 'com.example.app',
    platform: 'ios',
    channel: 'production',
    nativeVersion: '1.2.3',
    bundleId: '1.2.3-web.1',
    storageKey: 'bundles/ios.zip',
    downloadUrl: 'https://cdn.example.com/ios.zip',
    checksum: 'abc123',
    mandatory: true,
    rolloutPercent: 100,
    rolloutState: 'complete',
    releaseNotes: null,
    fileSizeBytes: 1234,
    storageObjectExists: true,
    isActive: false,
    createdAt: '2026-05-04T00:00:00.000Z',
    resolvedDownloadUrl: 'https://cdn.example.com/ios.zip',
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// Bundle prompt resolution
// -----------------------------------------------------------------------------

describe('bundleCommandTestUtils.resolveBundleNativeVersionInput', () => {
  test('uses explicit native version without prompting', async () => {
    const nativeVersion = await bundleCommandTestUtils.resolveBundleNativeVersionInput({
      context: {
        cwd: '/tmp/project',
      },
      options: {
        'native-version': '9.9.9',
      },
      platform: 'ios',
      manifest: MANIFEST,
      isInteractive: true,
      prompt: async () => {
        throw new Error('Prompt should not be called.')
      },
    })

    expect(nativeVersion).toBe('9.9.9')
  })

  test('prompts with the active native version as fallback', async () => {
    const prompts: Array<{ hint: string, fallback?: string }> = []
    const nativeVersion = await bundleCommandTestUtils.resolveBundleNativeVersionInput({
      context: {
        cwd: '/tmp/project',
      },
      options: {},
      platform: 'ios',
      manifest: MANIFEST,
      isInteractive: true,
      detectNativeVersion: async () => '2.0.0',
      prompt: async input => {
        prompts.push({
          hint: input.hint,
          fallback: input.fallback,
        })
        return input.fallback ?? ''
      },
    })

    expect(nativeVersion).toBe('2.0.0')
    expect(prompts).toEqual([
      {
        fallback: '2.0.0',
        hint: [
          'Active native version: 2.0.0',
          'Current bundle native version: 1.2.3',
          'Press Enter to use the active native version, or type another exact native app version.',
        ].join('\n'),
      },
    ])
  })

  test('does not prompt for native version in non-interactive mode', async () => {
    const nativeVersion = await bundleCommandTestUtils.resolveBundleNativeVersionInput({
      context: {
        cwd: '/tmp/project',
      },
      options: {},
      platform: 'ios',
      manifest: MANIFEST,
      isInteractive: false,
      prompt: async () => {
        throw new Error('Prompt should not be called.')
      },
    })

    expect(nativeVersion).toBeUndefined()
  })
})

describe('bundleCommandTestUtils.resolveBundleIdInput', () => {
  test('uses explicit bundle ID without prompting', async () => {
    const input = await bundleCommandTestUtils.resolveBundleIdInput({
      options: {
        'bundle-id': '9.9.9-web.1',
      },
      platform: 'ios',
      nativeVersion: '1.2.3',
      manifest: MANIFEST,
      isInteractive: true,
      prompt: async () => {
        throw new Error('Prompt should not be called.')
      },
    })

    expect(input).toEqual({
      bundleId: '9.9.9-web.1',
      bundleIdSource: 'flag',
    })
  })

  test('prompts with the local and published bundle IDs in the hint', async () => {
    const prompts: Array<{ hint: string, example?: string }> = []
    const input = await bundleCommandTestUtils.resolveBundleIdInput({
      options: {},
      platform: 'ios',
      nativeVersion: '2.0.0',
      manifest: MANIFEST,
      publishedBundle: {
        channel: 'production',
        bundleId: '1.2.3-web.3',
        checked: true,
      },
      isInteractive: true,
      prompt: async promptInput => {
        prompts.push({
          hint: promptInput.hint,
          example: promptInput.example,
        })
        return '1.2.3-web.5'
      },
    })

    expect(input).toEqual({
      bundleId: '1.2.3-web.5',
      bundleIdSource: 'prompt',
    })
    expect(prompts).toEqual([
      {
        example: undefined,
        hint: [
          'Local bundle ID: 1.2.3-web.4',
          'Published bundle ID (production): 1.2.3-web.3',
          'Type the bundle ID to release, or press Enter to generate one from nativeVersion and the bundle hash.',
        ].join('\n'),
      },
    ])
  })

  test('keeps auto-generated bundle IDs when the prompt is left empty', async () => {
    const input = await bundleCommandTestUtils.resolveBundleIdInput({
      options: {},
      platform: 'ios',
      nativeVersion: '1.2.3',
      manifest: MANIFEST,
      isInteractive: true,
      prompt: async () => '',
    })

    expect(input).toEqual({
      bundleId: undefined,
      bundleIdSource: undefined,
    })
  })

  test('shows an example when no local or published bundle ID is available', async () => {
    const prompts: Array<{ hint: string, example?: string }> = []
    const input = await bundleCommandTestUtils.resolveBundleIdInput({
      options: {},
      platform: 'android',
      nativeVersion: '2.0.0',
      manifest: MANIFEST,
      publishedBundle: {
        channel: 'production',
        checked: true,
      },
      isInteractive: true,
      prompt: async promptInput => {
        prompts.push({
          hint: promptInput.hint,
          example: promptInput.example,
        })
        return ''
      },
    })

    expect(input).toEqual({
      bundleId: undefined,
      bundleIdSource: undefined,
    })
    expect(prompts).toEqual([
      {
        example: '2.0.0-web.1',
        hint: [
          'No local bundle ID found for this platform.',
          'Published bundle ID (production): none found.',
          'Type the bundle ID to release, or press Enter to generate one from nativeVersion and the bundle hash.',
        ].join('\n'),
      },
    ])
  })

  test('does not prompt when bundle ID comes from package.json', async () => {
    const input = await bundleCommandTestUtils.resolveBundleIdInput({
      options: {
        'bundle-from-package': true,
      },
      platform: 'ios',
      nativeVersion: '1.2.3',
      manifest: MANIFEST,
      isInteractive: true,
      prompt: async () => {
        throw new Error('Prompt should not be called.')
      },
    })

    expect(input).toEqual({
      bundleId: undefined,
      bundleIdSource: undefined,
    })
  })
})

describe('bundleCommandTestUtils.resolvePublishedBundleHint', () => {
  test('returns the published bundle ID loaded for the selected tuple', async () => {
    const hint = await bundleCommandTestUtils.resolvePublishedBundleHint({
      context: {
        cwd: '/tmp/project',
      },
      options: {
        channel: 'staging',
      },
      platform: 'android',
      nativeVersion: '2.0.0',
      loadPublishedBundleId: async input => {
        expect(input).toEqual({
          channel: 'staging',
          platform: 'android',
          nativeVersion: '2.0.0',
        })

        return '2.0.0-web.1'
      },
    })

    expect(hint).toEqual({
      channel: 'staging',
      bundleId: '2.0.0-web.1',
      checked: true,
    })
  })

  test('uses production for the published bundle lookup by default', async () => {
    const hint = await bundleCommandTestUtils.resolvePublishedBundleHint({
      context: {
        cwd: '/tmp/project',
      },
      options: {},
      platform: 'ios',
      nativeVersion: '2.0.0',
      loadPublishedBundleId: async input => input.channel,
    })

    expect(hint).toEqual({
      channel: 'production',
      bundleId: 'production',
      checked: true,
    })
  })

  test('skips published bundle lookup when native version is unavailable', async () => {
    const hint = await bundleCommandTestUtils.resolvePublishedBundleHint({
      context: {
        cwd: '/tmp/project',
      },
      options: {},
      platform: 'ios',
      loadPublishedBundleId: async () => {
        throw new Error('Lookup should not be called.')
      },
    })

    expect(hint).toBeUndefined()
  })

  test('marks published bundle lookup unavailable when it fails', async () => {
    const hint = await bundleCommandTestUtils.resolvePublishedBundleHint({
      context: {
        cwd: '/tmp/project',
      },
      options: {},
      platform: 'ios',
      nativeVersion: '2.0.0',
      loadPublishedBundleId: async () => {
        throw new Error('Network unavailable.')
      },
    })

    expect(hint).toEqual({
      channel: 'production',
      checked: false,
    })
  })
})

describe('bundleCommandTestUtils.resolvePublishedBundleIdFromReleases', () => {
  test('prefers the active published bundle', () => {
    expect(bundleCommandTestUtils.resolvePublishedBundleIdFromReleases([
      createRelease({
        bundleId: '1.2.3-web.1',
        isActive: false,
        createdAt: '2026-05-04T00:00:00.000Z',
      }),
      createRelease({
        bundleId: '1.2.3-web.2',
        isActive: true,
        createdAt: '2026-05-03T00:00:00.000Z',
      }),
    ])).toBe('1.2.3-web.2')
  })

  test('falls back to the latest published bundle when none is active', () => {
    expect(bundleCommandTestUtils.resolvePublishedBundleIdFromReleases([
      createRelease({
        bundleId: '1.2.3-web.1',
        createdAt: '2026-05-03T00:00:00.000Z',
      }),
      createRelease({
        bundleId: '1.2.3-web.2',
        createdAt: '2026-05-04T00:00:00.000Z',
      }),
    ])).toBe('1.2.3-web.2')
  })
})
