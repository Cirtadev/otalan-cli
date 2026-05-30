import { describe, expect, test } from 'bun:test'

import { handlePause, handleResume } from '../../src/commands/release'
import { stripAnsiLines } from '../helpers/ansi'
import {
  createProjectFixture,
  createRelease,
  createReleaseContextResponse,
} from './release.fixtures'

describe('handlePause', () => {
  test('pauses the active rollout for the selected tuple', async () => {
    const cwd = await createProjectFixture()
    const output: string[] = []
    const requestedPaths: string[] = []

    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    }

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      requestedPaths.push(`${init?.method ?? 'GET'} ${url.pathname}`)

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/pause') {
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
          'Content-Type': 'application/json',
        })
        expect(JSON.parse(init?.body as string)).toEqual({
          appId: 'com.example.app',
          platform: 'ios',
          channel: 'production',
          runtimeVersion: '1.0.0',
        })

        return new Response(JSON.stringify({
          item: createRelease({
            isActive: true,
            rolloutState: 'paused',
          }),
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await handlePause({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })

    expect(requestedPaths).toEqual([
      'GET /v1/releases/context',
      'POST /v1/releases/pause',
    ])
    const cleanOutput = stripAnsiLines(output)

    expect(cleanOutput).toContain('✓ Rollout paused')
    expect(cleanOutput.join('\n')).toContain('│ State           │ paused')
  })

  test('surfaces the API error when no active bundle exists', async () => {
    const cwd = await createProjectFixture()

    console.log = () => {}

    globalThis.fetch = (async (input) => {
      const url = new URL(String(input))

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/pause') {
        return new Response(JSON.stringify({
          message: 'No active bundle found for the selected release tuple',
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await expect(handlePause({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })).rejects.toThrow('No active bundle found for the selected release tuple')
  })
})

describe('handleResume', () => {
  test('resumes the active rollout for the selected tuple', async () => {
    const cwd = await createProjectFixture()
    const output: string[] = []
    const requestedPaths: string[] = []

    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    }

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      requestedPaths.push(`${init?.method ?? 'GET'} ${url.pathname}`)

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/resume') {
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
          'Content-Type': 'application/json',
        })
        expect(JSON.parse(init?.body as string)).toEqual({
          appId: 'com.example.app',
          platform: 'ios',
          channel: 'production',
          runtimeVersion: '1.0.0',
        })

        return new Response(JSON.stringify({
          item: createRelease({
            isActive: true,
            rolloutState: 'active',
          }),
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await handleResume({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })

    expect(requestedPaths).toEqual([
      'GET /v1/releases/context',
      'POST /v1/releases/resume',
    ])
    const cleanOutput = stripAnsiLines(output)

    expect(cleanOutput).toContain('✓ Rollout resumed')
    expect(cleanOutput.join('\n')).toContain('│ State           │ active')
  })
})
