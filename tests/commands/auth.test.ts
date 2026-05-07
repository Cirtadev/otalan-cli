import { afterEach, describe, expect, test } from 'bun:test'

import { authCommandTestUtils, handleDoctor } from '../../src/commands/auth'

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const originalFetch = globalThis.fetch
const originalLog = console.log

afterEach(() => {
  globalThis.fetch = originalFetch
  console.log = originalLog
})

// -----------------------------------------------------------------------------
// Doctor command
// -----------------------------------------------------------------------------

describe('handleDoctor', () => {
  test('checks API connectivity and prints the CI key context', async () => {
    const events: string[] = []

    console.log = (...values: unknown[]) => {
      events.push(values.map(String).join(' '))
    }

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

    await handleDoctor({
      'api-key': 'test-key',
      'api-url': 'https://api.otalan.com',
    })

    expect(events).toEqual([
      'Otalan API connection OK.',
      'API URL: https://api.otalan.com',
      'Organization: test-org',
      'Project: test-project',
    ])
    expect(events.join('\n')).not.toContain('test-key')
  })
})

describe('authCommandTestUtils', () => {
  test('masks stored CI keys without exposing the full value', () => {
    expect(authCommandTestUtils.maskApiKey('otalan_ci_1234567890abcdef')).toBe('otalan_ci_...cdef')
  })

  test('formats app select options with app names and identifiers', () => {
    expect(authCommandTestUtils.formatAppOption({
      name: 'Example App',
      appId: 'com.example.app',
    })).toBe('Example App (com.example.app)')
  })

  test('validates explicit init app IDs against active project apps', async () => {
    await expect(authCommandTestUtils.resolveInitAppId({
      apps: [{
        name: 'Example App',
        appId: 'com.example.app',
      }],
      options: {
        'app-id': 'com.example.app',
      },
    })).resolves.toBe('com.example.app')

    await expect(authCommandTestUtils.resolveInitAppId({
      apps: [{
        name: 'Example App',
        appId: 'com.example.app',
      }],
      options: {
        'app-id': 'com.missing.app',
      },
    })).rejects.toThrow('App "com.missing.app" was not found in the logged-in project, or it is archived.')
  })
})
