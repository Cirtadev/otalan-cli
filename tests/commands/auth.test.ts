import { afterEach, describe, expect, test } from 'bun:test'

import { handleDoctor } from '../../src/commands/auth'

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
