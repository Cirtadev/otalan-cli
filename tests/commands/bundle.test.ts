import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { bundleCommandTestUtils, handleBundle } from '../../src/commands/bundle'
import { stripAnsi, stripAnsiLines } from '../helpers/ansi'
import {
  createRelease,
  createReleaseContextResponse,
  forceStaticProgressOutput,
} from './bundle.fixtures'

describe('handleBundle', () => {
  test('prints compact bundle progress by default', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-bundle-context-'))
    const output: string[] = []

    try {
      await mkdir(path.join(cwd, 'dist'), { recursive: true })
      await Bun.write(path.join(cwd, 'dist', 'index.html'), '<script src="app.js"></script>')
      await Bun.write(path.join(cwd, 'dist', 'app.js'), 'console.log("app")')
      await Bun.write(path.join(cwd, 'otalan.config.json'), `${JSON.stringify({
        organizationSlug: 'test-org',
        projectSlug: 'mobile-app',
        appName: 'Customer Portal',
        appId: 'com.example.app',
      }, null, 2)}\n`)

      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(' '))
      }
      console.warn = () => {}
      forceStaticProgressOutput()
      globalThis.fetch = (async () => {
        throw new Error('Network unavailable.')
      }) as unknown as typeof fetch

      await handleBundle({ cwd }, {
        target: 'capacitor',
        platform: 'ios',
        'runtime-version': '1.2.3',
        'bundle-id': '1.2.3-web.1',
      })

      const outputDir = path.join(cwd, '.otalan', 'bundle')

      expect(stripAnsiLines(output)).toEqual([
        '',
        '✓ Bundling',
        '',
        '✓ Bundle created',
        stripAnsi(bundleCommandTestUtils.formatBundleDirectoryHint({
          cwd,
          outputDir,
        })),
      ])
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('prints bundle details when verbose is set', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-bundle-context-'))
    const output: string[] = []

    try {
      await mkdir(path.join(cwd, 'dist'), { recursive: true })
      await Bun.write(path.join(cwd, 'dist', 'index.html'), '<script src="app.js"></script>')
      await Bun.write(path.join(cwd, 'dist', 'app.js'), 'console.log("app")')
      await Bun.write(path.join(cwd, 'otalan.config.json'), `${JSON.stringify({
        organizationSlug: 'test-org',
        projectSlug: 'mobile-app',
        appName: 'Customer Portal',
        appId: 'com.example.app',
      }, null, 2)}\n`)

      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(' '))
      }
      console.warn = () => {}
      forceStaticProgressOutput()
      globalThis.fetch = (async () => {
        throw new Error('Network unavailable.')
      }) as unknown as typeof fetch

      await handleBundle({ cwd }, {
        target: 'capacitor',
        platform: 'ios',
        'runtime-version': '1.2.3',
        'bundle-id': '1.2.3-web.1',
        v: true,
      })

      const cleanOutput = stripAnsiLines(output)
      const joinedOutput = cleanOutput.join('\n')

      expect(joinedOutput).toContain('│ Organization │ test-org')
      expect(joinedOutput).toContain('│ Project      │ mobile-app')
      expect(joinedOutput).toContain('│ App          │ Customer Portal (com.example.app) │')
      expect(cleanOutput).toContain('Build web assets before running `otalan bundle`.')
      expect(cleanOutput).toContain('✓ Bundling')
      expect(cleanOutput).toContain('✓ Bundle created')
      expect(cleanOutput).toContain(stripAnsi(bundleCommandTestUtils.formatBundleDirectoryHint({
        cwd,
        outputDir: path.join(cwd, '.otalan', 'bundle'),
      })))
      expect(joinedOutput).toContain('Using bundle ID from --bundle-id.')
      expect(joinedOutput).toContain('"bundleId": "1.2.3-web.1"')
      expect(joinedOutput.indexOf('│ App          │ Customer Portal (com.example.app) │')).toBeLessThan(
        joinedOutput.indexOf('Build web assets before running `otalan bundle`.'),
      )
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('rejects an already published bundle ID before writing output', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-bundle-'))
    const outputDir = path.join(cwd, '.otalan', 'bundle')
    const requests: string[] = []

    try {
      await mkdir(path.join(cwd, 'dist'), { recursive: true })
      await Bun.write(path.join(cwd, 'dist', 'index.html'), '<script src="app.js"></script>')
      await Bun.write(path.join(cwd, 'dist', 'app.js'), 'console.log("app")')
      await Bun.write(path.join(cwd, 'otalan.config.json'), `${JSON.stringify({
        organizationSlug: 'test-org',
        projectSlug: 'mobile-app',
        appId: 'com.example.app',
      }, null, 2)}\n`)

      console.log = () => {}
      globalThis.fetch = (async (input, init) => {
        const url = new URL(String(input))

        requests.push(`${init?.method ?? 'GET'} ${url.pathname}`)

        if (url.pathname === '/v1/releases/context') {
          expect(init?.headers).toEqual({
            'x-api-key': 'test-key',
          })

          return createReleaseContextResponse()
        }

        if (url.pathname === '/v1/releases') {
          expect(url.searchParams.get('appId')).toBe('com.example.app')
          expect(url.searchParams.get('platform')).toBe('ios')
          expect(url.searchParams.get('channel')).toBe('production')
          expect(url.searchParams.get('runtimeVersion')).toBe('1.2.3')
          expect(url.searchParams.get('bundleId')).toBe('1.2.3-web.1')

          return new Response(JSON.stringify({
            items: [createRelease({
              runtimeVersion: '1.2.3',
              bundleId: '1.2.3-web.1',
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

      await expect(handleBundle({ cwd }, {
        'api-key': 'test-key',
        'api-url': 'https://api.otalan.com',
        target: 'capacitor',
        platform: 'ios',
        'runtime-version': '1.2.3',
        'bundle-id': '1.2.3-web.1',
      })).rejects.toThrow(
        'Bundle ID "1.2.3-web.1" already exists for ios channel "production" and runtimeVersion "1.2.3".',
      )

      expect(requests).toEqual([
        'GET /v1/releases/context',
        'GET /v1/releases',
      ])
      expect(await Bun.file(path.join(outputDir, 'bundle-1.2.3-web.1.zip')).exists()).toBe(false)
      expect(await Bun.file(path.join(outputDir, 'manifest.json')).exists()).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('bundleCommandTestUtils.formatBundleDirectoryHint', () => {
  test('prints the generated bundle folder', () => {
    const cwd = '/project'
    const outputDir = '/project/.otalan/bundle'

    expect(stripAnsi(bundleCommandTestUtils.formatBundleDirectoryHint({
      cwd,
      outputDir,
    }))).toBe([
      '┌───────────────┬────────────────┐',
      '│ Output folder │ .otalan/bundle │',
      '└───────────────┴────────────────┘',
    ].join('\n'))
  })

  test('prints absolute output folders outside the project', () => {
    expect(stripAnsi(bundleCommandTestUtils.formatBundleDirectoryHint({
      cwd: '/project',
      outputDir: '/tmp/otalan-bundle',
    }))).toBe([
      '┌───────────────┬────────────────────┐',
      '│ Output folder │ /tmp/otalan-bundle │',
      '└───────────────┴────────────────────┘',
    ].join('\n'))
  })
})
