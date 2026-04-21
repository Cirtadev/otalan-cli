import { afterEach, describe, expect, test } from 'bun:test'

import { createRelease, getReleaseIngest } from '../src/http'

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

function mockQueuedIngestFetch(expectedPath: string, method: 'GET' | 'POST' = 'POST') {
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toBe(`https://api.otalan.com${expectedPath}`)
    expect(init?.method).toBe(method)
    expect(init?.headers).toEqual({
      'x-api-key': 'test-key',
    })

    return new Response(JSON.stringify({
      item: createQueuedIngest(),
    }), {
      status: 202,
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
