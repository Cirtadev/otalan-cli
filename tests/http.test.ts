import { afterEach, describe, expect, test } from 'bun:test'

import {
  cancelReleaseUpload,
  completeReleaseUpload,
  createReleaseUploadIntent,
  getReleaseContext,
  getReleaseIngest,
  listReleaseApps,
  listReleases,
  pauseRelease,
  resumeRelease,
  uploadReleaseArchive,
} from '../src/http'

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
    runtimeVersion: '1.0.0',
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

function createRelease(overrides: Record<string, unknown> = {}) {
  return {
    id: 'release-123',
    projectId: 'project-123',
    appId: 'com.example.app',
    platform: 'ios',
    channel: 'production',
    runtimeVersion: '1.0.0',
    bundleId: '1.0.0-web.2',
    releaseStorageId: 'release-storage-123',
    checksum: 'abc123',
    mandatory: true,
    rolloutPercent: 100,
    rolloutState: 'active',
    releaseNotes: null,
    fileSizeBytes: 1234,
    storageObjectExists: true,
    isActive: true,
    publishedAt: '2026-04-21T00:00:00.000Z',
    resolvedDownloadUrl: 'https://cdn.example.com/bundle.zip',
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

function createArchiveBlob() {
  return new Blob(['zip-bytes'], {
    type: 'application/zip',
  })
}

// -----------------------------------------------------------------------------
// Release ingest requests
// -----------------------------------------------------------------------------

describe('getReleaseContext', () => {
  test('reads the authenticated OTA Publish Key context', async () => {
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
  test('lists active apps in the authenticated publish-key project', async () => {
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

describe('createReleaseUploadIntent', () => {
  test('posts JSON rollout metadata to the create ingest endpoint', async () => {
    let requestBody: unknown = null

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.otalan.com/v1/releases/create')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
        'Content-Type': 'application/json',
      })
      requestBody = init?.body

      return new Response(JSON.stringify({
        item: createQueuedIngest({
          id: 'ingest-456',
          mandatory: false,
          rolloutPercent: 25,
          releaseNotes: 'Fixes startup crash',
        }),
        uploadUrl: 'https://upload.example.test/quarantine.zip',
        contentType: 'application/zip',
      }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    const intent = await createReleaseUploadIntent({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      bundleId: '1.0.0-web.2',
      mandatory: false,
      rolloutPercent: 25,
      releaseNotes: 'Fixes startup crash',
      fileName: 'bundle.zip',
      fileSizeBytes: 9,
      contentType: 'application/zip',
      expoManifest: '{"target":"expo","bundleId":"1.0.0-web.2","runtimeVersion":"1.0.0","launchAsset":"entry.hbc","assets":[],"expoConfig":{"scheme":"example"}}',
    })

    expect(intent.item.id).toBe('ingest-456')
    expect(intent.item.rolloutPercent).toBe(25)
    expect(intent.item.releaseNotes).toBe('Fixes startup crash')
    expect(intent.uploadUrl).toBe('https://upload.example.test/quarantine.zip')
    expect(intent.contentType).toBe('application/zip')
    expect(typeof requestBody).toBe('string')
    expect(JSON.parse(requestBody as string)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      bundleId: '1.0.0-web.2',
      mandatory: false,
      rolloutPercent: 25,
      releaseNotes: 'Fixes startup crash',
      fileName: 'bundle.zip',
      fileSizeBytes: 9,
      contentType: 'application/zip',
      expoManifest: '{"target":"expo","bundleId":"1.0.0-web.2","runtimeVersion":"1.0.0","launchAsset":"entry.hbc","assets":[],"expoConfig":{"scheme":"example"}}',
    })
  })
})

describe('uploadReleaseArchive', () => {
  test('puts the archive body directly to the opaque upload URL', async () => {
    const archive = createArchiveBlob()

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://upload.example.test/quarantine.zip')
      expect(init?.method).toBe('PUT')
      expect(init?.headers).toEqual({
        'Content-Type': 'application/zip',
      })
      expect(init?.body).toBe(archive)
      expect(await new Response(init?.body as BodyInit).text()).toBe('zip-bytes')

      return new Response('', {
        status: 200,
      })
    }) as typeof fetch

    await uploadReleaseArchive({
      uploadUrl: 'https://upload.example.test/quarantine.zip',
      archive,
      contentType: 'application/zip',
    })
  })
})

describe('completeReleaseUpload', () => {
  test('marks the uploaded ingest complete without sending a ZIP body', async () => {
    mockQueuedIngestFetch('/v1/releases/ingests/ingest-123/complete')

    const item = await completeReleaseUpload({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      ingestId: 'ingest-123',
    })

    expect(item.id).toBe('ingest-123')
    expect(item.status).toBe('pending')
  })
})

describe('cancelReleaseUpload', () => {
  test('cancels an unfinished upload intent without sending a ZIP body', async () => {
    mockQueuedIngestFetch('/v1/releases/ingests/ingest-123/cancel')

    const item = await cancelReleaseUpload({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      ingestId: 'ingest-123',
    })

    expect(item.id).toBe('ingest-123')
    expect(item.status).toBe('pending')
  })
})

describe('pauseRelease', () => {
  test('posts the release tuple to the pause endpoint', async () => {
    let requestBody: unknown = null

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.otalan.com/v1/releases/pause')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
        'Content-Type': 'application/json',
      })
      requestBody = init?.body

      return new Response(JSON.stringify({
        item: createRelease({
          rolloutState: 'paused',
        }),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    const item = await pauseRelease({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
    })

    expect(item.rolloutState).toBe('paused')
    expect(JSON.parse(requestBody as string)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
    })
  })
})

describe('resumeRelease', () => {
  test('posts the release tuple to the resume endpoint', async () => {
    let requestBody: unknown = null

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.otalan.com/v1/releases/resume')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
        'Content-Type': 'application/json',
      })
      requestBody = init?.body

      return new Response(JSON.stringify({
        item: createRelease(),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    const item = await resumeRelease({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
    })

    expect(item.rolloutState).toBe('active')
    expect(JSON.parse(requestBody as string)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
    })
  })
})

describe('release request errors', () => {
  test('explains that archived apps are unavailable to release operations', async () => {
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
