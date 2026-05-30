import { describe, expect, test } from 'bun:test'

import { handleChannelsList, releaseTestUtils } from '../../src/commands/release'
import { stripAnsiLines } from '../helpers/ansi'
import { createReleaseContextResponse } from './release.fixtures'

describe('handleChannelsList', () => {
  test('lists project channels through the channels endpoint', async () => {
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
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/channels') {
        expect(url.search).toBe('')
        return new Response(JSON.stringify({
          items: [
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
          ],
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await handleChannelsList({
      'api-key': 'test-key',
    }, {
      isInteractive: () => false,
    })

    expect(requestedPaths).toEqual([
      '/v1/releases/context',
      '/v1/releases/channels',
    ])
    const joinedOutput = stripAnsiLines(output).join('\n')

    expect(joinedOutput).toContain('│ Organization │ Test Organization (test-org)')
    expect(joinedOutput).toContain('│ Project      │ Mobile App (mobile-app)')
    expect(joinedOutput).toContain('production')
    expect(joinedOutput).toContain('Example App (com.example.app)')
    expect(joinedOutput).toContain('staging')
    expect(joinedOutput).toContain('Staging App (com.example.staging)')
  })

  test('passes an explicit appId filter to the channels endpoint', async () => {
    const requestedPaths: string[] = []

    console.log = () => {}

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      requestedPaths.push(`${url.pathname}${url.search}`)

      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/channels') {
        return new Response(JSON.stringify({
          items: [],
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await handleChannelsList({
      'api-key': 'test-key',
      'app-id': 'com.example.app',
    })

    expect(requestedPaths).toEqual([
      '/v1/releases/context',
      '/v1/releases/channels?appId=com.example.app',
    ])
  })
})

describe('releaseTestUtils.resolveChannelsAppId', () => {
  test('uses explicit appId without prompting', async () => {
    await expect(releaseTestUtils.resolveChannelsAppId({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      options: {
        'app-id': 'com.example.app',
      },
      isInteractive: () => {
        throw new Error('Interactivity should not be checked.')
      },
    })).resolves.toBe('com.example.app')
  })

  test('defaults to all apps in non-interactive environments', async () => {
    await expect(releaseTestUtils.resolveChannelsAppId({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      options: {},
      isInteractive: () => false,
      loadApps: async () => {
        throw new Error('Apps should not be loaded.')
      },
    })).resolves.toBeUndefined()
  })

  test('offers All first as the interactive default', async () => {
    const promptInputs: unknown[] = []

    await expect(releaseTestUtils.resolveChannelsAppId({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      options: {},
      isInteractive: () => true,
      loadApps: async () => [
        {
          appId: 'com.example.app',
          name: 'Example App',
        },
      ],
      selectAppId: async input => {
        promptInputs.push(input)
        return input.fallback
      },
    })).resolves.toBeUndefined()

    expect(promptInputs).toEqual([
      {
        question: 'App',
        fallback: '__all__',
        hint: 'Filter channels by app, or keep All to show every project channel.',
        options: [
          {
            label: 'All',
            value: '__all__',
          },
          {
            label: 'Example App (com.example.app)',
            value: 'com.example.app',
          },
        ],
      },
    ])
  })

  test('returns the selected app in interactive environments', async () => {
    await expect(releaseTestUtils.resolveChannelsAppId({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      options: {},
      isInteractive: () => true,
      loadApps: async () => [
        {
          appId: 'com.example.app',
          name: 'Example App',
        },
      ],
      selectAppId: async () => 'com.example.app',
    })).resolves.toBe('com.example.app')
  })
})
