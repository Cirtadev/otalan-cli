import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { BundleIngestItem, ReleaseItem } from '../../src/http'
import { handlePause, handlePublish, handleResume, handleStatus, releaseTestUtils } from '../../src/commands/release'

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
    runtimeVersion: '1.0.0',
    bundleId: '1.0.0-web.2',
    releaseStorageId: 'release-storage-123',
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
    runtimeVersion: '1.0.0',
    bundleId: '1.0.0-web.1',
    releaseStorageId: 'release-storage-123',
    checksum: 'abc123',
    mandatory: true,
    rolloutPercent: 100,
    rolloutState: 'complete',
    releaseNotes: null,
    fileSizeBytes: 1234,
    storageObjectExists: true,
    isActive: false,
    publishedAt: '2026-04-21T00:00:00.000Z',
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
            publishedAt: '2026-04-22T00:00:00.000Z',
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
      expect(events.some(event => event.includes('publishedAt'))).toBe(true)
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
    appName: 'Customer Portal',
    appId: 'com.example.app',
  }, null, 2)}\n`)

  return cwd
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

describe('release command context output', () => {
  test('prints organization, project, and app before running a release command', async () => {
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
        expect(url.searchParams.get('runtimeVersion')).toBe('1.0.0')

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
      'runtime-version': '1.0.0',
    })

    expect(requestedPaths[0]).toBe('/v1/releases/context')
    expect(output).toContain('Organization: Test Organization (test-org)')
    expect(output).toContain('Project: Mobile App (mobile-app)')
    expect(output).toContain('App: Customer Portal (com.example.app)')
  })
})

// -----------------------------------------------------------------------------
// Rollout state commands
// -----------------------------------------------------------------------------

describe('handlePause', () => {
  test('pauses the active rollout for the selected tuple', async () => {
    const cwd = await createProjectFixture()
    const output: string[] = []
    const requestedPaths: string[] = []

    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    }

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      requestedPaths.push(`${init?.method ?? 'GET'} ${url.pathname}`)

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/pause') {
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
          'Content-Type': 'application/json',
        })
        expect(JSON.parse(init?.body as string)).toEqual({
          appId: 'com.example.app',
          platform: 'ios',
          channel: 'production',
          runtimeVersion: '1.0.0',
        })

        return new Response(JSON.stringify({
          item: createRelease({
            isActive: true,
            rolloutState: 'paused',
          }),
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await handlePause({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })

    expect(requestedPaths).toEqual([
      'GET /v1/releases/context',
      'POST /v1/releases/pause',
    ])
    expect(output).toContain('Rollout paused.')
    expect(output.join('\n')).toContain('State: paused')
  })

  test('surfaces the API error when no active bundle exists', async () => {
    const cwd = await createProjectFixture()

    console.log = () => {}

    globalThis.fetch = (async (input) => {
      const url = new URL(String(input))

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/pause') {
        return new Response(JSON.stringify({
          message: 'No active bundle found for the selected release tuple',
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await expect(handlePause({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })).rejects.toThrow('No active bundle found for the selected release tuple')
  })
})

describe('handleResume', () => {
  test('resumes the active rollout for the selected tuple', async () => {
    const cwd = await createProjectFixture()
    const output: string[] = []
    const requestedPaths: string[] = []

    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    }

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      requestedPaths.push(`${init?.method ?? 'GET'} ${url.pathname}`)

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/resume') {
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
          'Content-Type': 'application/json',
        })
        expect(JSON.parse(init?.body as string)).toEqual({
          appId: 'com.example.app',
          platform: 'ios',
          channel: 'production',
          runtimeVersion: '1.0.0',
        })

        return new Response(JSON.stringify({
          item: createRelease({
            isActive: true,
            rolloutState: 'active',
          }),
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await handleResume({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })

    expect(requestedPaths).toEqual([
      'GET /v1/releases/context',
      'POST /v1/releases/resume',
    ])
    expect(output).toContain('Rollout resumed.')
    expect(output.join('\n')).toContain('State: active')
  })
})

// -----------------------------------------------------------------------------
// Publish command
// -----------------------------------------------------------------------------

describe('handlePublish', () => {
  test('creates a direct upload intent, uploads the ZIP, and completes the ingest', async () => {
    const cwd = await createProjectFixture()
    const outputDir = path.join(cwd, '.otalan', 'bundle')
    const manifest = {
      target: 'expo',
      hash: '0'.repeat(64),
      runtimeVersion: '1.0.0',
      bundleId: '1.0.0-web.2',
      launchAsset: '_expo/static/js/ios/entry.hbc',
      assets: ['assets/icon.png'],
      expoConfig: {
        scheme: 'example',
      },
      createdAt: '2026-04-21T00:00:00.000Z',
      platform: 'ios',
    }
    const events: string[] = []

    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(outputDir, 'bundle.zip'), 'zip-bytes')
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    console.log = () => {}

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      events.push(`${init?.method ?? 'GET'} ${url.href}`)

      if (url.pathname === '/v1/releases/context') {
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
        })

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

      if (url.pathname === '/v1/releases/create') {
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
          'Content-Type': 'application/json',
        })

        const body = JSON.parse(init?.body as string) as Record<string, unknown>

        expect(body).toMatchObject({
          appId: 'com.example.app',
          platform: 'ios',
          channel: 'production',
          runtimeVersion: '1.0.0',
          bundleId: '1.0.0-web.2',
          fileName: 'bundle.zip',
          fileSizeBytes: 9,
          contentType: 'application/zip',
          mandatory: true,
          rolloutPercent: 100,
        })
        expect(JSON.parse(body.expoManifest as string)).toMatchObject({
          target: 'expo',
          launchAsset: '_expo/static/js/ios/entry.hbc',
          assets: ['assets/icon.png'],
          runtimeVersion: '1.0.0',
          bundleId: '1.0.0-web.2',
          expoConfig: {
            scheme: 'example',
          },
        })

        return new Response(JSON.stringify({
          item: createIngest({
            status: 'uploading',
          }),
          uploadUrl: 'https://upload.example.test/quarantine.zip',
          contentType: 'application/zip',
        }), {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (url.href === 'https://upload.example.test/quarantine.zip') {
        expect(init?.method).toBe('PUT')
        expect(init?.headers).toEqual({
          'Content-Type': 'application/zip',
        })
        const uploadBody = init?.body as Blob

        expect(uploadBody).toBeInstanceOf(Blob)
        expect(uploadBody).not.toBeInstanceOf(File)
        expect(await uploadBody.text()).toBe('zip-bytes')

        return new Response('', {
          status: 200,
        })
      }

      if (url.pathname === '/v1/releases/ingests/ingest-123/complete') {
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
        })
        expect(init?.body).toBeUndefined()

        return new Response(JSON.stringify({
          item: createIngest({
            status: 'pending',
          }),
        }), {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (url.pathname === '/v1/releases/ingests/ingest-123') {
        expect(init?.method).toBe('GET')
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
        })

        return new Response(JSON.stringify({
          item: createIngest({
            status: 'ready',
            checksum: '0'.repeat(64),
            processedAt: '2026-04-21T00:00:02.000Z',
          }),
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.href}`)
    }) as typeof fetch

    await handlePublish({ cwd }, {
      'api-key': 'test-key',
      'api-url': 'https://api.otalan.com',
      channel: 'production',
    })

    expect(events).toEqual([
      'GET https://api.otalan.com/v1/releases/context',
      'POST https://api.otalan.com/v1/releases/create',
      'PUT https://upload.example.test/quarantine.zip',
      'POST https://api.otalan.com/v1/releases/ingests/ingest-123/complete',
      'GET https://api.otalan.com/v1/releases/ingests/ingest-123',
    ])
  })

  test('cancels the upload intent when direct object storage upload fails', async () => {
    const cwd = await createProjectFixture()
    const outputDir = path.join(cwd, '.otalan', 'bundle')
    const manifest = {
      target: 'capacitor',
      hash: '0'.repeat(64),
      runtimeVersion: '1.0.0',
      bundleId: '1.0.0-web.3',
      createdAt: '2026-04-21T00:00:00.000Z',
      platform: 'ios',
    }
    const events: string[] = []

    await mkdir(outputDir, { recursive: true })
    await writeFile(path.join(outputDir, 'bundle.zip'), 'zip-bytes')
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    console.log = () => {}

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      events.push(`${init?.method ?? 'GET'} ${url.href}`)

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

      if (url.pathname === '/v1/releases/create') {
        return new Response(JSON.stringify({
          item: createIngest({
            bundleId: '1.0.0-web.3',
            status: 'uploading',
          }),
          uploadUrl: 'https://upload.example.test/quarantine.zip',
          contentType: 'application/zip',
        }), {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (url.href === 'https://upload.example.test/quarantine.zip') {
        return new Response('<Error>Access Denied</Error>', {
          status: 403,
        })
      }

      if (url.pathname === '/v1/releases/ingests/ingest-123/cancel') {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
        })
        expect(init?.body).toBeUndefined()

        return new Response(JSON.stringify({
          item: createIngest({
            bundleId: '1.0.0-web.3',
            status: 'failed',
            failureReason: 'Upload cancelled before completion',
          }),
        }), {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.href}`)
    }) as typeof fetch

    await expect(handlePublish({ cwd }, {
      'api-key': 'test-key',
      'api-url': 'https://api.otalan.com',
      channel: 'production',
    })).rejects.toThrow('Direct bundle upload failed with status 403')

    expect(events).toEqual([
      'GET https://api.otalan.com/v1/releases/context',
      'POST https://api.otalan.com/v1/releases/create',
      'PUT https://upload.example.test/quarantine.zip',
      'POST https://api.otalan.com/v1/releases/ingests/ingest-123/cancel',
    ])
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
