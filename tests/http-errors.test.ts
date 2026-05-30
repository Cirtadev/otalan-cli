import { afterEach, describe, expect, test } from 'bun:test'

import { listReleases } from '../src/http'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
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

  test('includes non-JSON response bodies in API errors', async () => {
    globalThis.fetch = (async () =>
      new Response('Bad gateway from edge', {
        status: 502,
        headers: {
          'Content-Type': 'text/plain',
        },
      })) as unknown as typeof fetch

    await expect(listReleases({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
    })).rejects.toThrow('Request failed with status 502: Bad gateway from edge')
  })

  test('preserves empty query-string values', async () => {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input))

      expect(url.searchParams.has('channel')).toBe(true)
      expect(url.searchParams.get('channel')).toBe('')

      return new Response(JSON.stringify({
        items: [],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }) as typeof fetch

    await expect(listReleases({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      appId: 'com.example.app',
      channel: '',
    })).resolves.toEqual([])
  })
})
