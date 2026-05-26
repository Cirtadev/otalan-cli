import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { bundleCommandTestUtils, handleBundle } from '../../src/commands/bundle'
import type { BundleManifest } from '../../src/bundle'
import type { ReleaseItem } from '../../src/http'

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const originalFetch = globalThis.fetch
const originalConsoleLog = console.log
const originalConsoleWarn = console.warn

afterEach(() => {
  globalThis.fetch = originalFetch
  console.log = originalConsoleLog
  console.warn = originalConsoleWarn
})

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const MANIFEST = {
  target: 'capacitor',
  hash: 'abc123',
  runtimeVersion: '1.2.3',
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
    runtimeVersion: '1.2.3',
    bundleId: '1.2.3-web.1',
    releaseStorageId: 'release-storage-123',
    checksum: 'abc123',
    mandatory: true,
    rolloutPercent: 100,
    rolloutState: 'complete',
    releaseNotes: null,
    fileSizeBytes: 1234,
    storageObjectExists: true,
    isActive: false,
    publishedAt: '2026-05-04T00:00:00.000Z',
    resolvedDownloadUrl: 'https://cdn.example.com/ios.zip',
    ...overrides,
  }
}

function createReleaseContextResponse() {
  return new Response(JSON.stringify({
    item: {
      organizationId: 'org-123',
      organizationName: 'Test Organization',
      organizationSlug: 'test-org',
      projectId: 'project-123',
      projectName: 'Mobile App',
      projectSlug: 'mobile-app',
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

// -----------------------------------------------------------------------------
// Bundle command
// -----------------------------------------------------------------------------

describe('handleBundle', () => {
  test('prints the linked project and app before packaging', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-bundle-context-'))
    const output: string[] = []

    try {
      await mkdir(path.join(cwd, 'dist'), { recursive: true })
      await Bun.write(path.join(cwd, 'dist', 'index.html'), '<script src="app.js"></script>')
      await Bun.write(path.join(cwd, 'dist', 'app.js'), 'console.log("app")')
      await Bun.write(path.join(cwd, 'otalan.config.json'), `${JSON.stringify({
        organizationSlug: 'test-org',
        projectSlug: 'mobile-app',
        appName: 'Customer Portal',
        appId: 'com.example.app',
      }, null, 2)}\n`)

      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(' '))
      }
      console.warn = () => {}
      globalThis.fetch = (async () => {
        throw new Error('Network unavailable.')
      }) as unknown as typeof fetch

      await handleBundle({ cwd }, {
        target: 'capacitor',
        platform: 'ios',
        'runtime-version': '1.2.3',
        'bundle-id': '1.2.3-web.1',
      })

      expect(output).toContain('Organization: test-org')
      expect(output).toContain('Project: mobile-app')
      expect(output).toContain('App: Customer Portal (com.example.app)')
      expect(output).toContain('✅ Bundle generated')
      expect(output.at(-2)).toBe('')
      expect(output.at(-1)).toBe('✅ Bundle generated')
      expect(output.indexOf('App: Customer Portal (com.example.app)')).toBeLessThan(
        output.indexOf('Build web assets before running `otalan bundle`.'),
      )
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('rejects an already published bundle ID before writing output', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-bundle-'))
    const outputDir = path.join(cwd, '.otalan', 'bundle')
    const requests: string[] = []

    try {
      await mkdir(path.join(cwd, 'dist'), { recursive: true })
      await Bun.write(path.join(cwd, 'dist', 'index.html'), '<script src="app.js"></script>')
      await Bun.write(path.join(cwd, 'dist', 'app.js'), 'console.log("app")')
      await Bun.write(path.join(cwd, 'otalan.config.json'), `${JSON.stringify({
        organizationSlug: 'test-org',
        projectSlug: 'mobile-app',
        appId: 'com.example.app',
      }, null, 2)}\n`)

      console.log = () => {}
      globalThis.fetch = (async (input, init) => {
        const url = new URL(String(input))

        requests.push(`${init?.method ?? 'GET'} ${url.pathname}`)

        if (url.pathname === '/v1/releases/context') {
          expect(init?.headers).toEqual({
            'x-api-key': 'test-key',
          })

          return createReleaseContextResponse()
        }

        if (url.pathname === '/v1/releases') {
          expect(url.searchParams.get('appId')).toBe('com.example.app')
          expect(url.searchParams.get('platform')).toBe('ios')
          expect(url.searchParams.get('channel')).toBe('production')
          expect(url.searchParams.get('runtimeVersion')).toBe('1.2.3')
          expect(url.searchParams.get('bundleId')).toBe('1.2.3-web.1')

          return new Response(JSON.stringify({
            items: [createRelease({
              runtimeVersion: '1.2.3',
              bundleId: '1.2.3-web.1',
            })],
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          })
        }

        throw new Error(`Unexpected request: ${url.pathname}`)
      }) as typeof fetch

      await expect(handleBundle({ cwd }, {
        'api-key': 'test-key',
        'api-url': 'https://api.otalan.com',
        target: 'capacitor',
        platform: 'ios',
        'runtime-version': '1.2.3',
        'bundle-id': '1.2.3-web.1',
      })).rejects.toThrow(
        'Bundle ID "1.2.3-web.1" already exists for ios channel "production" and runtimeVersion "1.2.3".',
      )

      expect(requests).toEqual([
        'GET /v1/releases/context',
        'GET /v1/releases',
      ])
      expect(await Bun.file(path.join(outputDir, 'bundle-1.2.3-web.1.zip')).exists()).toBe(false)
      expect(await Bun.file(path.join(outputDir, 'manifest.json')).exists()).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

// -----------------------------------------------------------------------------
// Bundle prompt resolution
// -----------------------------------------------------------------------------

describe('bundleCommandTestUtils.resolveBundleRuntimeVersionInput', () => {
  test('uses explicit runtime version without prompting', async () => {
    const runtimeVersion = await bundleCommandTestUtils.resolveBundleRuntimeVersionInput({
      context: {
        cwd: '/tmp/project',
      },
      options: {
        'runtime-version': '9.9.9',
      },
      platform: 'ios',
      manifest: MANIFEST,
      isInteractive: true,
      prompt: async () => {
        throw new Error('Prompt should not be called.')
      },
    })

    expect(runtimeVersion).toBe('9.9.9')
  })

  test('prompts with the active runtime version as fallback', async () => {
    const prompts: Array<{ hint: string, fallback?: string }> = []
    const runtimeVersion = await bundleCommandTestUtils.resolveBundleRuntimeVersionInput({
      context: {
        cwd: '/tmp/project',
      },
      options: {},
      platform: 'ios',
      manifest: MANIFEST,
      isInteractive: true,
      detectRuntimeVersion: async () => '2.0.0',
      prompt: async input => {
        prompts.push({
          hint: input.hint,
          fallback: input.fallback,
        })
        return input.fallback ?? ''
      },
    })

    expect(runtimeVersion).toBe('2.0.0')
    expect(prompts).toEqual([
      {
        fallback: '2.0.0',
        hint: [
          'Active runtime version: 2.0.0',
          'Current bundle runtime version: 1.2.3',
          'Press Enter to use the active runtime version, or type another exact runtime version.',
        ].join('\n'),
      },
    ])
  })

  test('does not prompt for runtime version in non-interactive mode', async () => {
    const runtimeVersion = await bundleCommandTestUtils.resolveBundleRuntimeVersionInput({
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

    expect(runtimeVersion).toBeUndefined()
  })
})

describe('bundleCommandTestUtils.resolveBundleIdInput', () => {
  test('uses explicit bundle ID without prompting', async () => {
    const input = await bundleCommandTestUtils.resolveBundleIdInput({
      options: {
        'bundle-id': '9.9.9-web.1',
      },
      platform: 'ios',
      runtimeVersion: '1.2.3',
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
      runtimeVersion: '2.0.0',
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
          'Type the bundle ID to release, or press Enter to generate one from runtimeVersion and the bundle hash.',
        ].join('\n'),
      },
    ])
  })

  test('keeps auto-generated bundle IDs when the prompt is left empty', async () => {
    const input = await bundleCommandTestUtils.resolveBundleIdInput({
      options: {},
      platform: 'ios',
      runtimeVersion: '1.2.3',
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
      runtimeVersion: '2.0.0',
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
          'Type the bundle ID to release, or press Enter to generate one from runtimeVersion and the bundle hash.',
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
      runtimeVersion: '1.2.3',
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
      runtimeVersion: '2.0.0',
      loadPublishedBundleId: async input => {
        expect(input).toEqual({
          channel: 'staging',
          platform: 'android',
          runtimeVersion: '2.0.0',
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
      runtimeVersion: '2.0.0',
      loadPublishedBundleId: async input => input.channel,
    })

    expect(hint).toEqual({
      channel: 'production',
      bundleId: 'production',
      checked: true,
    })
  })

  test('skips published bundle lookup when runtime version is unavailable', async () => {
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
      runtimeVersion: '2.0.0',
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

describe('bundleCommandTestUtils.resolveExistingPublishedBundleCheck', () => {
  test('loads an existing bundle for the selected release tuple', async () => {
    const release = createRelease({
      platform: 'android',
      channel: 'staging',
      runtimeVersion: '2.0.0',
      bundleId: '2.0.0-web.1',
    })
    const check = await bundleCommandTestUtils.resolveExistingPublishedBundleCheck({
      context: {
        cwd: '/tmp/project',
      },
      options: {
        channel: 'staging',
      },
      platform: 'android',
      runtimeVersion: '2.0.0',
      bundleId: '2.0.0-web.1',
      loadExistingBundle: async input => {
        expect(input).toEqual({
          channel: 'staging',
          platform: 'android',
          runtimeVersion: '2.0.0',
          bundleId: '2.0.0-web.1',
        })

        return release
      },
    })

    expect(check).toEqual({
      channel: 'staging',
      checked: true,
      release,
    })
  })

  test('marks the duplicate lookup unavailable when it fails', async () => {
    const check = await bundleCommandTestUtils.resolveExistingPublishedBundleCheck({
      context: {
        cwd: '/tmp/project',
      },
      options: {},
      platform: 'ios',
      runtimeVersion: '1.2.3',
      bundleId: '1.2.3-web.1',
      loadExistingBundle: async () => {
        throw new Error('Network unavailable.')
      },
    })

    expect(check).toEqual({
      channel: 'production',
      checked: false,
      unavailableReason: 'Network unavailable.',
    })
  })
})

describe('bundleCommandTestUtils.assertNoExistingPublishedBundle', () => {
  test('throws when the selected bundle ID already exists', () => {
    expect(() => bundleCommandTestUtils.assertNoExistingPublishedBundle({
      channel: 'production',
      checked: true,
      release: createRelease({
        bundleId: '1.2.3-web.1',
      }),
    })).toThrow(
      'Bundle ID "1.2.3-web.1" already exists for ios channel "production" and runtimeVersion "1.2.3".',
    )
  })

  test('allows unavailable checks so bundle remains offline capable', () => {
    expect(() => bundleCommandTestUtils.assertNoExistingPublishedBundle({
      channel: 'production',
      checked: false,
    })).not.toThrow()
  })
})

describe('bundleCommandTestUtils.warnUnavailableExistingPublishedBundleCheck', () => {
  test('warns when the duplicate-bundle check could not run', () => {
    const warnings: string[] = []

    console.warn = (...values: unknown[]) => {
      warnings.push(values.map(String).join(' '))
    }

    bundleCommandTestUtils.warnUnavailableExistingPublishedBundleCheck({
      check: {
        channel: 'production',
        checked: false,
      },
      platform: 'ios',
      runtimeVersion: '1.2.3',
      bundleId: '1.2.3-web.1',
    })

    expect(warnings).toEqual([
      'Unable to verify whether bundle ID "1.2.3-web.1" already exists for ios channel "production" and runtimeVersion "1.2.3". Continuing without the duplicate-bundle guardrail.',
    ])
  })

  test('does not warn when auth has not been configured', () => {
    const warnings: string[] = []

    console.warn = (...values: unknown[]) => {
      warnings.push(values.map(String).join(' '))
    }

    bundleCommandTestUtils.warnUnavailableExistingPublishedBundleCheck({
      check: {
        channel: 'production',
        checked: false,
        unavailableReason: 'No OTA Publish Key configured. Run `otalan login` first or pass --api-key.',
      },
      platform: 'ios',
      runtimeVersion: '1.2.3',
      bundleId: '1.2.3-web.1',
    })

    expect(warnings).toEqual([])
  })
})

describe('bundleCommandTestUtils.findExistingPublishedBundle', () => {
  test('matches bundle IDs only within the selected release tuple', () => {
    expect(bundleCommandTestUtils.findExistingPublishedBundle({
      releases: [
        createRelease({
          channel: 'staging',
          bundleId: '1.2.3-web.1',
        }),
        createRelease({
          channel: 'production',
          bundleId: '1.2.3-web.2',
        }),
      ],
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.2.3',
      bundleId: '1.2.3-web.1',
    })).toBeUndefined()
  })
})

describe('bundleCommandTestUtils.resolvePublishedBundleIdFromReleases', () => {
  test('prefers the active published bundle', () => {
    expect(bundleCommandTestUtils.resolvePublishedBundleIdFromReleases([
      createRelease({
        bundleId: '1.2.3-web.1',
        isActive: false,
        publishedAt: '2026-05-04T00:00:00.000Z',
      }),
      createRelease({
        bundleId: '1.2.3-web.2',
        isActive: true,
        publishedAt: '2026-05-03T00:00:00.000Z',
      }),
    ])).toBe('1.2.3-web.2')
  })

  test('falls back to the latest published bundle when none is active', () => {
    expect(bundleCommandTestUtils.resolvePublishedBundleIdFromReleases([
      createRelease({
        bundleId: '1.2.3-web.1',
        publishedAt: '2026-05-03T00:00:00.000Z',
      }),
      createRelease({
        bundleId: '1.2.3-web.2',
        publishedAt: '2026-05-04T00:00:00.000Z',
      }),
    ])).toBe('1.2.3-web.2')
  })
})
