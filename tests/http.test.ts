import { afterEach, describe, expect, test } from 'bun:test'

import {
  cancelReleaseUpload,
  completeReleaseUpload,
  createReleaseUploadIntent,
  getReleaseContext,
  getReleaseIngest,
  listReleaseApps,
  listReleaseChannels,
  listReleases,
  uploadReleaseArchive,
} from '../src/http'

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

describe('listReleaseChannels', () => {
  test('lists project release channels with their apps', async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://api.otalan.com/v1/releases/channels')
      expect(init?.method).toBe('GET')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      return new Response(JSON.stringify({
        items: [
          {
            channel: 'staging',
            apps: [
              {
                appId: 'com.example.staging',
                name: 'Staging App',
              },
            ],
          },
          {
            channel: 'production',
            apps: [
              {
                appId: 'com.example.app',
                name: 'Example App',
              },
            ],
          },
        ],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    const items = await listReleaseChannels({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
    })

    expect(items).toEqual([
      {
        channel: 'production',
        apps: [
          {
            appId: 'com.example.app',
            name: 'Example App',
          },
        ],
      },
      {
        channel: 'staging',
        apps: [
          {
            appId: 'com.example.staging',
            name: 'Staging App',
          },
        ],
      },
    ])
  })

  test('sorts apps in each channel for stable output', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          {
            channel: 'production',
            apps: [
              {
                appId: 'com.example.z',
                name: 'Zeta App',
              },
              {
                appId: 'com.example.a',
                name: 'Alpha App',
              },
            ],
          },
        ],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })) as unknown as typeof fetch

    await expect(listReleaseChannels({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
    })).resolves.toEqual([
      {
        channel: 'production',
        apps: [
          {
            appId: 'com.example.a',
            name: 'Alpha App',
          },
          {
            appId: 'com.example.z',
            name: 'Zeta App',
          },
        ],
      },
    ])
  })

  test('sends an appId filter when provided', async () => {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input))

      expect(url.href).toBe('https://api.otalan.com/v1/releases/channels?appId=com.example.app')

      return new Response(JSON.stringify({
        items: [],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    await expect(listReleaseChannels({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
    })).resolves.toEqual([])
  })
})

describe('listReleases', () => {
  test('lists releases with offset pagination query params and metadata', async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe(
        'https://api.otalan.com/v1/releases?appId=com.example.app&platform=ios&channel=production&runtimeVersion=1.0.0&page=2&pageSize=50',
      )
      expect(init?.method).toBe('GET')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      return new Response(JSON.stringify({
        items: [{
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
          rolloutState: 'complete',
          releaseNotes: null,
          fileSizeBytes: 1234,
          storageObjectExists: true,
          isActive: false,
          publishedAt: '2026-04-21T00:00:00.000Z',
          resolvedDownloadUrl: 'https://cdn.example.com/ios.zip',
        }],
        pagination: {
          page: 2,
          pageSize: 50,
          totalItems: 51,
          totalPages: 2,
          hasPreviousPage: true,
          hasNextPage: false,
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    const page = await listReleases({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      page: 2,
      pageSize: 50,
    })

    expect(page.pagination).toEqual({
      page: 2,
      pageSize: 50,
      totalItems: 51,
      totalPages: 2,
      hasPreviousPage: true,
      hasNextPage: false,
    })
    expect(page.items[0]?.bundleId).toBe('1.0.0-web.2')
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
        uploadHeaders: {
          'Content-Type': 'application/zip',
          'Content-Length': '9',
        },
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
    expect(intent.uploadHeaders).toEqual({
      'Content-Type': 'application/zip',
      'Content-Length': '9',
    })
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
        'Content-Length': '9',
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
      uploadHeaders: {
        'Content-Type': 'application/zip',
        'Content-Length': '9',
      },
    })
  })

  test('requires storage upload headers before direct upload', async () => {
    const failFetch = async () => {
      throw new Error('Direct upload should not start')
    }

    globalThis.fetch = failFetch as unknown as typeof fetch

    await expect(uploadReleaseArchive({
      uploadUrl: 'https://upload.example.test/quarantine.zip',
      archive: createArchiveBlob(),
      uploadHeaders: {
        'Content-Type': 'application/zip',
      },
    })).rejects.toThrow('Upload intent is missing required storage upload headers')
  })

  test('rejects non-HTTPS upload URLs outside local development', async () => {
    const failFetch = async () => {
      throw new Error('Direct upload should not start')
    }

    globalThis.fetch = failFetch as unknown as typeof fetch

    await expect(uploadReleaseArchive({
      uploadUrl: 'http://upload.example.test/quarantine.zip',
      archive: createArchiveBlob(),
      uploadHeaders: {
        'Content-Type': 'application/zip',
        'Content-Length': '9',
      },
    })).rejects.toThrow('Refusing to upload bundle over non-HTTPS URL.')
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
