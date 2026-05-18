import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { authCommandTestUtils, handleDoctor, handleInit } from '../../src/commands/auth'

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

// -----------------------------------------------------------------------------
// Init command
// -----------------------------------------------------------------------------

describe('handleInit', () => {
  test('stores the selected app name in the project config', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-init-'))

    try {
      globalThis.fetch = (async (input, init) => {
        const url = new URL(String(input))

        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
        })

        if (url.pathname === '/v1/releases/context') {
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
        }

        if (url.pathname === '/v1/releases/apps') {
          return new Response(JSON.stringify({
            items: [{
              name: 'Customer Portal',
              appId: 'com.example.app',
            }],
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          })
        }

        throw new Error(`Unexpected request: ${url.pathname}`)
      }) as typeof fetch

      console.log = () => {}

      await handleInit({ cwd }, {
        'api-key': 'test-key',
        'api-url': 'https://api.otalan.com',
        'app-id': 'com.example.app',
      })

      await expect(Bun.file(path.join(cwd, 'otalan.config.json')).json()).resolves.toMatchObject({
        organizationSlug: 'test-org',
        projectSlug: 'test-project',
        appName: 'Customer Portal',
        appId: 'com.example.app',
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('authCommandTestUtils', () => {
  test('uses the default API URL without prompting when an API key is provided', async () => {
    const prompts: string[] = []

    const input = await authCommandTestUtils.resolveLoginInput(
      {
        'api-key': 'test-key',
      },
      async prompt => {
        prompts.push(prompt.question)
        return 'https://prompted.example.com'
      },
      async () => {
        throw new Error('No stored config.')
      },
    )

    expect(input).toEqual({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
    })
    expect(prompts).toEqual([])
  })

  test('uses the stored API URL without prompting when only the API key is provided', async () => {
    const prompts: string[] = []

    const input = await authCommandTestUtils.resolveLoginInput(
      {
        'api-key': 'test-key',
      },
      async prompt => {
        prompts.push(prompt.question)
        return 'https://prompted.example.com'
      },
      async () => ({
        apiUrl: 'https://staging.example.com',
        apiKey: 'stored-key',
      }),
    )

    expect(input).toEqual({
      apiUrl: 'https://staging.example.com',
      apiKey: 'test-key',
    })
    expect(prompts).toEqual([])
  })

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
