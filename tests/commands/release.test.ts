import { describe, expect, test } from 'bun:test'

import {
  handleBundlesList,
  handleRollback,
  handleStatus,
  releaseTestUtils,
} from '../../src/commands/release'
import {
  createProjectFixture,
  createReleasePagination,
  createRelease,
  createReleaseContextResponse,
} from './release.fixtures'
import { stripAnsi, stripAnsiLines } from '../helpers/ansi'

describe('releaseTestUtils.resolveRollbackTargetBundleId', () => {
  test('prompts for rollback bundles with a selectable list', async () => {
    const originalLog = console.log
    const events: string[] = []
    const prompts: Array<{
      fallback?: string
      hint: string
      options: ReadonlyArray<{ disabled?: boolean, hint?: string, label: string, value: string }>
      question: string
    }> = []

    console.log = (...values: unknown[]) => {
      events.push(values.map(String).join(' '))
    }

    try {
      const targetBundleId = await releaseTestUtils.resolveRollbackTargetBundleId({
        options: {},
        releases: [
          createRelease({
            bundleId: '1.0.0-web.2',
            isActive: true,
            publishedAt: '2026-04-22T00:00:00.000Z',
          }),
          createRelease(),
          createRelease({
            bundleId: '1.0.0-web.0',
            resolvedDownloadUrl: null,
            storageObjectExists: false,
          }),
        ],
        selectTargetBundleId: async prompt => {
          prompts.push(prompt)
          return '1.0.0-web.1'
        },
      })

      expect(targetBundleId).toBe('1.0.0-web.1')
      expect(events).toEqual([])
      expect(prompts).toHaveLength(1)
      expect(prompts[0]?.fallback).toBe('1.0.0-web.1')
      expect(prompts[0]?.hint).toBe(
        'Select a previous bundle with an available archive. The current live bundle and deleted archives are disabled.',
      )
      expect(prompts[0]?.question).toBe('Bundle to reactivate')
      expect(prompts[0]?.options.map(option => ({
        ...option,
        label: stripAnsi(option.label),
      }))).toEqual([
        {
          disabled: true,
          hint: 'ios/production, runtime 1.0.0, mandatory, current live bundle',
          label: '1.0.0-web.2 | Current Live | 100% | 2026-04-22 00:00:00',
          value: '1.0.0-web.2',
        },
        {
          hint: 'ios/production, runtime 1.0.0, mandatory, available rollback target',
          label: '1.0.0-web.1 | Rollback target | 100% | 2026-04-21 00:00:00',
          value: '1.0.0-web.1',
        },
        {
          disabled: true,
          hint: 'ios/production, runtime 1.0.0, mandatory, archive unavailable',
          label: '1.0.0-web.0 | Archive unavailable | 100% | 2026-04-21 00:00:00',
          value: '1.0.0-web.0',
        },
      ])
      expect(prompts[0]?.options[0]?.label).toContain('\x1B[32m')
    } finally {
      console.log = originalLog
    }
  })

  test('uses the option value without printing choices', async () => {
    const originalLog = console.log
    const events: string[] = []

    console.log = (...values: unknown[]) => {
      events.push(values.map(String).join(' '))
    }

    try {
      const targetBundleId = await releaseTestUtils.resolveRollbackTargetBundleId({
        options: {
          'bundle-id': '1.0.0-web.1',
        },
        releases: [
          createRelease(),
        ],
        selectTargetBundleId: async () => {
          throw new Error('Prompt should not be called.')
        },
      })

      expect(targetBundleId).toBe('1.0.0-web.1')
      expect(events).toEqual([])
    } finally {
      console.log = originalLog
    }
  })

  test('rejects rollback prompts when no bundle archive is selectable', async () => {
    await expect(releaseTestUtils.resolveRollbackTargetBundleId({
      options: {},
      releases: [
        createRelease({
          resolvedDownloadUrl: null,
          storageObjectExists: false,
        }),
      ],
      selectTargetBundleId: async () => {
        throw new Error('Prompt should not be called.')
      },
    })).rejects.toThrow(
      'No previous rollback bundle archives are available for the selected platform, channel, and runtimeVersion.',
    )
  })
})

describe('releaseTestUtils.resolveReleasePaginationOptions', () => {
  test('reads optional release page and page size options', () => {
    expect(releaseTestUtils.resolveReleasePaginationOptions({
      page: '2',
      'page-size': '50',
    })).toEqual({
      page: 2,
      pageSize: 50,
    })
  })

  test('rejects invalid release page sizes before calling the API', () => {
    expect(() => releaseTestUtils.resolveReleasePaginationOptions({
      'page-size': '101',
    })).toThrow('page-size must be an integer between 1 and 100.')
  })
})

describe('releaseTestUtils.formatReleasePaginationSummary', () => {
  test('prints out-of-range pages without an inverted item range', () => {
    expect(stripAnsi(releaseTestUtils.formatReleasePaginationSummary(createReleasePagination({
      page: 3,
      pageSize: 50,
      totalItems: 51,
      totalPages: 2,
      hasPreviousPage: true,
    })))).toBe('i Page 3 of 2 (no items on this page; 51 total). Use --page 2 for the previous page.')
  })

  test('prints empty result sets without a range', () => {
    expect(stripAnsi(releaseTestUtils.formatReleasePaginationSummary(createReleasePagination({
      totalItems: 0,
    })))).toBe('i Page 1 of 1 (0 of 0).')
  })
})

describe('handleRollback', () => {
  test('exits without prompting when no bundles are available', async () => {
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

      if (url.pathname === '/v1/releases') {
        return new Response(JSON.stringify({
          items: [],
          pagination: createReleasePagination({
            totalItems: 0,
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

    await handleRollback({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })

    expect(requestedPaths).toEqual([
      'GET /v1/releases/context',
      'GET /v1/releases',
    ])
    const cleanOutput = stripAnsiLines(output)

    expect(cleanOutput.at(-2)).toBe('')
    expect(cleanOutput).toContain('i No bundles found for the selected platform, channel, and runtimeVersion.')
    expect(cleanOutput).not.toContain('Available bundles')
  })

  test('prints a checked rollback done message', async () => {
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

      if (url.pathname === '/v1/releases') {
        expect(url.searchParams.get('bundleId')).toBe('1.0.0-web.1')

        return new Response(JSON.stringify({
          items: [createRelease()],
          pagination: createReleasePagination(),
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (url.pathname === '/v1/releases/rollback') {
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
          'Content-Type': 'application/json',
        })
        expect(JSON.parse(init?.body as string)).toEqual({
          appId: 'com.example.app',
          platform: 'ios',
          channel: 'production',
          runtimeVersion: '1.0.0',
          targetBundleId: '1.0.0-web.1',
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

    await handleRollback({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
      'bundle-id': '1.0.0-web.1',
    })

    expect(requestedPaths).toEqual([
      'GET /v1/releases/context',
      'GET /v1/releases',
      'POST /v1/releases/rollback',
    ])
    const cleanOutput = stripAnsiLines(output)
    const joinedOutput = cleanOutput.join('\n')

    expect(joinedOutput).toContain('\nBundle selected\n')
    expect(joinedOutput).toContain('│ Bundle ID       │ 1.0.0-web.1')
    expect(cleanOutput.at(-1)).toBe('✓ Rollback done')
    expect(cleanOutput).not.toContain('Rollback applied.')
    expect(joinedOutput.indexOf('Bundle selected')).toBeLessThan(joinedOutput.indexOf('✓ Rollback done'))
  })
})

describe('release command context output', () => {
  test('prints organization, project, and app before running a release command', async () => {
    const cwd = await createProjectFixture()
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
        return new Response(JSON.stringify({
          item: {
            organizationId: 'org-123',
            organizationName: 'Test Organization',
            organizationSlug: 'test-org',
            projectId: 'project-123',
            projectName: 'Mobile App',
            projectSlug: 'mobile-app',
          },
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (url.pathname === '/v1/releases') {
        expect(url.searchParams.get('appId')).toBe('com.example.app')
        expect(url.searchParams.get('platform')).toBe('ios')
        expect(url.searchParams.get('channel')).toBe('production')
        expect(url.searchParams.get('runtimeVersion')).toBe('1.0.0')
        expect(url.searchParams.get('page')).toBe('1')
        expect(url.searchParams.get('pageSize')).toBe('100')

        return new Response(JSON.stringify({
          items: [createRelease({
            bundleId: '1.0.0-web.2',
            isActive: true,
            rolloutState: 'active',
            resolvedDownloadUrl: 'https://cdn.example.com/bundle.zip',
          })],
          pagination: createReleasePagination(),
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await handleStatus({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })

    expect(requestedPaths[0]).toBe('/v1/releases/context')
    const cleanOutput = stripAnsiLines(output)
    const joinedOutput = cleanOutput.join('\n')
    const contextBottomIndex = cleanOutput.findIndex(line => line.startsWith('└──────────────'))

    expect(cleanOutput[contextBottomIndex + 1]).toBe('')
    expect(cleanOutput[contextBottomIndex + 2]).toBe('Active bundle')
    expect(joinedOutput).toContain('│ Organization │ Test Organization (test-org)')
    expect(joinedOutput).toContain('│ Project      │ Mobile App (mobile-app)')
    expect(joinedOutput).toContain('│ App          │ Customer Portal (com.example.app) │')
  })
})

describe('handleBundlesList', () => {
  test('lists remote bundles for the selected release tuple', async () => {
    const cwd = await createProjectFixture()
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

      if (url.pathname === '/v1/releases') {
        expect(url.searchParams.get('appId')).toBe('com.example.app')
        expect(url.searchParams.get('platform')).toBe('ios')
        expect(url.searchParams.get('channel')).toBe('production')
        expect(url.searchParams.get('runtimeVersion')).toBe('1.0.0')
        expect(url.searchParams.get('page')).toBe('2')
        expect(url.searchParams.get('pageSize')).toBe('50')

        return new Response(JSON.stringify({
          items: [createRelease({
            bundleId: '1.0.0-web.2',
            isActive: true,
            rolloutState: 'active',
            resolvedDownloadUrl: 'https://cdn.example.com/bundle.zip',
          })],
          pagination: createReleasePagination({
            page: 2,
            pageSize: 50,
            totalItems: 51,
            totalPages: 2,
            hasPreviousPage: true,
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

    await handleBundlesList({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
      page: '2',
      'page-size': '50',
    })

    expect(requestedPaths).toEqual([
      '/v1/releases/context',
      '/v1/releases?appId=com.example.app&platform=ios&channel=production&runtimeVersion=1.0.0&page=2&pageSize=50',
    ])
    const joinedOutput = stripAnsiLines(output).join('\n')

    expect(joinedOutput).toContain('│ Organization │ Test Organization (test-org)')
    expect(joinedOutput).toContain('bundleId')
    expect(joinedOutput).toContain('1.0.0-web.2')
    expect(joinedOutput).toContain('active')
    expect(joinedOutput).toContain('i Page 2 of 2 (51-51 of 51). Use --page 1 for the previous page.')
  })

  test('lists remote bundles when the API omits pagination metadata', async () => {
    const cwd = await createProjectFixture()
    const output: string[] = []

    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    }

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))

      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases') {
        return new Response(JSON.stringify({
          items: [createRelease({
            bundleId: '1.0.0-web.2',
            isActive: true,
            rolloutState: 'active',
          })],
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.pathname}`)
    }) as typeof fetch

    await handleBundlesList({ cwd }, {
      'api-key': 'test-key',
      platform: 'ios',
      channel: 'production',
      'runtime-version': '1.0.0',
    })

    const joinedOutput = stripAnsiLines(output).join('\n')

    expect(joinedOutput).toContain('1.0.0-web.2')
    expect(joinedOutput).toContain('i Page 1 of 1 (1-1 of 1).')
  })
})
