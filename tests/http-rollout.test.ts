import { afterEach, describe, expect, test } from 'bun:test'

import { pauseRelease, resumeRelease } from '../src/http'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

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
