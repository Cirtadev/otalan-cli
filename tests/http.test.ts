import { afterEach, describe, expect, test } from 'bun:test'

import { createRelease, getReleaseContext, getReleaseIngest, listReleaseApps, listReleases } from '../src/http'

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function createQueuedIngest(overrides: Record<string, unknown> = {}) {
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

function mockQueuedIngestFetch(
  expectedPath: string,
  method: 'GET' | 'POST' = 'POST',
  status = method === 'GET' ? 200 : 202,
) {
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toBe(`https://api.otalan.com${expectedPath}`)
    expect(init?.method).toBe(method)
    expect(init?.headers).toEqual({
      'x-api-key': 'test-key',
    })

    return new Response(JSON.stringify({
      item: createQueuedIngest(),
    }), {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }) as typeof fetch
}

function createArchiveFile() {
  return new File(['zip-bytes'], 'bundle.zip', {
    type: 'application/zip',
  })
}

// -----------------------------------------------------------------------------
// Release ingest requests
// -----------------------------------------------------------------------------

describe('getReleaseContext', () => {
  test('reads the authenticated CI key context', async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.otalan.com/v1/releases/context')
      expect(init?.method).toBe('GET')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      return new Response(JSON.stringify({
        item: {
          organizationId: 'org-123',
          organizationName: 'Test Org',
          organizationSlug: 'test-org',
          projectId: 'project-123',
          projectName: 'Test Project',
          projectSlug: 'test-project',
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    const item = await getReleaseContext({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
    })

    expect(item.organizationSlug).toBe('test-org')
    expect(item.projectSlug).toBe('test-project')
  })
})

describe('listReleaseApps', () => {
  test('lists active apps in the authenticated CI project', async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.otalan.com/v1/releases/apps')
      expect(init?.method).toBe('GET')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      return new Response(JSON.stringify({
        items: [{
          name: 'Example App',
          appId: 'com.example.app',
        }],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    const items = await listReleaseApps({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
    })

    expect(items).toEqual([{
      name: 'Example App',
      appId: 'com.example.app',
    }])
  })
})

describe('getReleaseIngest', () => {
  test('reads the current ingest state from the public ingest endpoint', async () => {
    mockQueuedIngestFetch('/v1/releases/ingests/ingest-123', 'GET')

    const item = await getReleaseIngest({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      ingestId: 'ingest-123',
    })

    expect(item.id).toBe('ingest-123')
    expect(item.status).toBe('pending')
  })
})

describe('createRelease', () => {
  test('posts rollout metadata to the create ingest endpoint', async () => {
    let requestBody: unknown = null

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.otalan.com/v1/releases/create')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })
      expect(init?.body).toBeInstanceOf(FormData)
      requestBody = init?.body

      return new Response(JSON.stringify({
        item: createQueuedIngest({
          id: 'ingest-456',
          mandatory: false,
          rolloutPercent: 25,
          releaseNotes: 'Fixes startup crash',
        }),
      }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    const item = await createRelease({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      nativeVersion: '1.0.0',
      bundleId: '1.0.0-web.2',
      mandatory: false,
      rolloutPercent: 25,
      releaseNotes: 'Fixes startup crash',
      file: createArchiveFile(),
      expoConfig: {
        scheme: 'example',
      },
    })

    expect(item.id).toBe('ingest-456')
    expect(item.rolloutPercent).toBe(25)
    expect(item.releaseNotes).toBe('Fixes startup crash')
    if (!(requestBody instanceof FormData)) {
      throw new Error('Expected form data request body')
    }

    const formData: FormData = requestBody

    expect(formData.get('mandatory')).toBe('false')
    expect(formData.get('rolloutPercent')).toBe('25')
    expect(formData.get('releaseNotes')).toBe('Fixes startup crash')
    expect(formData.get('expoConfig')).toBe('{"scheme":"example"}')
  })
})

describe('release request errors', () => {
  test('explains that archived apps are unavailable to CI release operations', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        message: 'App not found in selected project',
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
        },
      })) as unknown as typeof fetch

    await expect(listReleases({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
    })).rejects.toThrow(
      'App not found in selected project. Check that appId is correct and the app is not archived.',
    )
  })
})
