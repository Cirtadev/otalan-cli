import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { BundleIngestItem, ReleaseItem } from '../../src/http'
import { handleStatus, releaseTestUtils } from '../../src/commands/release'

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const originalFetch = globalThis.fetch
const originalConsoleLog = console.log

afterEach(() => {
  globalThis.fetch = originalFetch
  console.log = originalConsoleLog
})

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function createIngest(overrides: Partial<BundleIngestItem> = {}): BundleIngestItem {
  return {
    id: 'ingest-123',
    appId: 'com.example.app',
    platform: 'ios',
    channel: 'production',
    nativeVersion: '1.0.0',
    bundleId: '1.0.0-web.2',
    status: 'pending',
    failureReason: null,
    checksum: null,
    mandatory: true,
    rolloutPercent: 100,
    releaseNotes: null,
    fileSizeBytes: 1234,
    processedAt: null,
    createdAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  }
}

function createRelease(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    id: 'release-123',
    projectId: 'project-123',
    appId: 'com.example.app',
    platform: 'ios',
    channel: 'production',
    nativeVersion: '1.0.0',
    bundleId: '1.0.0-web.1',
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
    createdAt: '2026-04-21T00:00:00.000Z',
    resolvedDownloadUrl: 'https://cdn.example.com/ios.zip',
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// Rollback command
// -----------------------------------------------------------------------------

describe('releaseTestUtils.resolveRollbackTargetBundleId', () => {
  test('prints available bundles before prompting for the target bundle ID', async () => {
    const originalLog = console.log
    const events: string[] = []

    console.log = (...values: unknown[]) => {
      events.push(values.map(String).join(' '))
    }

    try {
      const targetBundleId = await releaseTestUtils.resolveRollbackTargetBundleId({
        options: {},
        releases: [
          createRelease({
            bundleId: '1.0.0-web.2',
            isActive: true,
            createdAt: '2026-04-22T00:00:00.000Z',
          }),
          createRelease(),
        ],
        promptTargetBundleId: async example => {
          events.push(`PROMPT ${example}`)
          return '1.0.0-web.1'
        },
      })

      expect(targetBundleId).toBe('1.0.0-web.1')
      expect(events).toContain('Available bundles')
      expect(events.some(event => event.includes('bundleId'))).toBe(true)
      expect(events.some(event => event.includes('createdAt'))).toBe(true)
      expect(events.some(event => event.includes('2026-04-22 00:00:00'))).toBe(true)
      expect(events.some(event => event.includes('1.0.0-web.2'))).toBe(true)
      expect(events.some(event => event.includes('1.0.0-web.1'))).toBe(true)
      expect(events.indexOf('Available bundles')).toBeLessThan(events.indexOf('PROMPT 1.0.0-web.2'))
    } finally {
      console.log = originalLog
    }
  })

  test('uses the option value without printing choices', async () => {
    const originalLog = console.log
    const events: string[] = []

    console.log = (...values: unknown[]) => {
      events.push(values.map(String).join(' '))
    }

    try {
      const targetBundleId = await releaseTestUtils.resolveRollbackTargetBundleId({
        options: {
          'bundle-id': '1.0.0-web.1',
        },
        releases: [
          createRelease(),
        ],
        promptTargetBundleId: async () => {
          throw new Error('Prompt should not be called.')
        },
      })

      expect(targetBundleId).toBe('1.0.0-web.1')
      expect(events).toEqual([])
    } finally {
      console.log = originalLog
    }
  })
})

// -----------------------------------------------------------------------------
// Release context output
// -----------------------------------------------------------------------------

async function createProjectFixture() {
  const cwd = path.join(os.tmpdir(), `otalan-cli-release-${crypto.randomUUID()}`)

  await mkdir(cwd, { recursive: true })
  await writeFile(path.join(cwd, 'otalan.config.json'), `${JSON.stringify({
    organizationSlug: 'test-org',
    projectSlug: 'mobile-app',
    appId: 'com.example.app',
  }, null, 2)}\n`)

  return cwd
}

describe('release command context output', () => {
  test('prints organization and project before running a release command', async () => {
    const cwd = await createProjectFixture()
    const output: string[] = []
    const requestedPaths: string[] = []

    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    }

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      requestedPaths.push(`${url.pathname}${url.search}`)

      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      if (url.pathname === '/v1/releases/context') {
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

      if (url.pathname === '/v1/releases') {
        expect(url.searchParams.get('appId')).toBe('com.example.app')
        expect(url.searchParams.get('platform')).toBe('ios')
        expect(url.searchParams.get('channel')).toBe('production')
        expect(url.searchParams.get('nativeVersion')).toBe('1.0.0')

        return new Response(JSON.stringify({
          items: [createRelease({
            bundleId: '1.0.0-web.2',
            isActive: true,
            rolloutState: 'active',
            resolvedDownloadUrl: 'https://cdn.example.com/bundle.zip',
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

    await handleStatus({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'native-version': '1.0.0',
    })

    expect(requestedPaths[0]).toBe('/v1/releases/context')
    expect(output).toContain('Organization: Test Organization (test-org)')
    expect(output).toContain('Project: Mobile App (mobile-app)')
  })
})

// -----------------------------------------------------------------------------
// Ingest polling
// -----------------------------------------------------------------------------

describe('releaseTestUtils.waitForReleaseIngest', () => {
  test('waits until the ingest reaches ready', async () => {
    const observedStatuses: string[] = []
    const clock = { now: 0 }

    const completed = await releaseTestUtils.waitForReleaseIngest({
      ingest: createIngest(),
      loadIngest: async () => {
        if (observedStatuses.length === 0) {
          return createIngest({
            status: 'processing',
          })
        }

        return createIngest({
          status: 'ready',
          checksum: 'abc123',
          processedAt: '2026-04-21T00:00:03.000Z',
        })
      },
      onStatusChange: ingest => {
        observedStatuses.push(ingest.status)
      },
      pollIntervalMs: 1,
      timeoutMs: 10,
      sleep: async () => {
        clock.now += 1
      },
      now: () => clock.now,
    })

    expect(observedStatuses).toEqual(['processing', 'ready'])
    expect(completed.status).toBe('ready')
    expect(completed.checksum).toBe('abc123')
  })

  test('returns the failed ingest so callers can surface the failure reason', async () => {
    const failed = await releaseTestUtils.waitForReleaseIngest({
      ingest: createIngest(),
      loadIngest: async () =>
        createIngest({
          status: 'failed',
          failureReason: 'Checksum mismatch',
          processedAt: '2026-04-21T00:00:02.000Z',
        }),
      pollIntervalMs: 1,
      timeoutMs: 10,
      sleep: async () => undefined,
      now: () => 0,
    })

    expect(failed.status).toBe('failed')
    expect(failed.failureReason).toBe('Checksum mismatch')
  })

  test('times out when the ingest never reaches a terminal state', async () => {
    const clock = { now: 0 }

    await expect(releaseTestUtils.waitForReleaseIngest({
      ingest: createIngest(),
      loadIngest: async () =>
        createIngest({
          status: 'processing',
        }),
      pollIntervalMs: 2,
      timeoutMs: 5,
      sleep: async (ms: number) => {
        clock.now += ms
      },
      now: () => clock.now,
    })).rejects.toThrow('Timed out waiting for release validation. Ingest ingest-123 is still processing.')
  })
})

describe('releaseTestUtils.resolveRolloutPercent', () => {
  test('defaults to 100 when the option is omitted', () => {
    expect(releaseTestUtils.resolveRolloutPercent({})).toBe(100)
  })

  test('accepts integer percentages in range', () => {
    expect(releaseTestUtils.resolveRolloutPercent({
      'rollout-percent': '25',
    })).toBe(25)
  })

  test('rejects fractional percentages before calling the API', () => {
    expect(() => releaseTestUtils.resolveRolloutPercent({
      'rollout-percent': '25.5',
    })).toThrow('rollout-percent must be an integer between 0 and 100.')
  })
})
