import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { stdout } from 'node:process'

import type { BundleIngestItem } from '../../src/http'
import { handlePublish } from '../../src/commands/release'

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const originalFetch = globalThis.fetch
const originalConsoleLog = console.log
const originalStdoutIsTTY = stdout.isTTY

afterEach(() => {
  globalThis.fetch = originalFetch
  console.log = originalConsoleLog
  Object.defineProperty(stdout, 'isTTY', {
    configurable: true,
    value: originalStdoutIsTTY,
  })
})

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function createIngest(overrides: Partial<BundleIngestItem> = {}): BundleIngestItem {
  return {
    id: 'ingest-123',
    appId: 'com.example.app',
    platform: 'ios',
    channel: 'production',
    runtimeVersion: '1.0.0',
    bundleId: '1.0.0-web.2',
    releaseStorageId: 'release-storage-123',
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

async function createProjectFixture() {
  const cwd = path.join(os.tmpdir(), `otalan-cli-release-publish-${crypto.randomUUID()}`)

  await mkdir(path.join(cwd, '.otalan', 'bundle'), { recursive: true })
  await writeFile(path.join(cwd, 'otalan.config.json'), `${JSON.stringify({
    organizationSlug: 'test-org',
    projectSlug: 'mobile-app',
    appName: 'Customer Portal',
    appId: 'com.example.app',
  }, null, 2)}\n`)

  return cwd
}

async function createPublishFixture() {
  const cwd = await createProjectFixture()
  const outputDir = path.join(cwd, '.otalan', 'bundle')
  const manifest = {
    target: 'expo',
    hash: '0'.repeat(64),
    runtimeVersion: '1.0.0',
    bundleId: '1.0.0-web.2',
    launchAsset: '_expo/static/js/ios/entry.hbc',
    assets: ['assets/icon.png'],
    expoConfig: {
      scheme: 'example',
    },
    createdAt: '2026-04-21T00:00:00.000Z',
    platform: 'ios',
  }

  await writeFile(path.join(outputDir, 'bundle-1.0.0-web.2.zip'), 'zip-bytes')
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  return cwd
}

function createReleaseContextResponse() {
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

function mockSuccessfulPublish(events: string[]) {
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    events.push(`${init?.method ?? 'GET'} ${url.href}`)

    if (url.pathname === '/v1/releases/context') {
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      return createReleaseContextResponse()
    }

    if (url.pathname === '/v1/releases/create') {
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
        'Content-Type': 'application/json',
      })

      const body = JSON.parse(init?.body as string) as Record<string, unknown>

      expect(body).toMatchObject({
        appId: 'com.example.app',
        platform: 'ios',
        channel: 'production',
        runtimeVersion: '1.0.0',
        bundleId: '1.0.0-web.2',
        fileName: 'bundle-1.0.0-web.2.zip',
        fileSizeBytes: 9,
        contentType: 'application/zip',
        mandatory: true,
        rolloutPercent: 100,
      })
      expect(JSON.parse(body.expoManifest as string)).toMatchObject({
        target: 'expo',
        launchAsset: '_expo/static/js/ios/entry.hbc',
        assets: ['assets/icon.png'],
        runtimeVersion: '1.0.0',
        bundleId: '1.0.0-web.2',
        expoConfig: {
          scheme: 'example',
        },
      })

      return new Response(JSON.stringify({
        item: createIngest({
          status: 'uploading',
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
    }

    if (url.href === 'https://upload.example.test/quarantine.zip') {
      expect(init?.method).toBe('PUT')
      expect(init?.headers).toEqual({
        'Content-Type': 'application/zip',
        'Content-Length': '9',
      })
      const uploadBody = init?.body as Blob

      expect(uploadBody).toBeInstanceOf(Blob)
      expect(uploadBody).not.toBeInstanceOf(File)
      expect(await uploadBody.text()).toBe('zip-bytes')

      return new Response('', {
        status: 200,
      })
    }

    if (url.pathname === '/v1/releases/ingests/ingest-123/complete') {
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })
      expect(init?.body).toBeUndefined()

      return new Response(JSON.stringify({
        item: createIngest({
          status: 'pending',
        }),
      }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    if (url.pathname === '/v1/releases/ingests/ingest-123') {
      expect(init?.method).toBe('GET')
      expect(init?.headers).toEqual({
        'x-api-key': 'test-key',
      })

      return new Response(JSON.stringify({
        item: createIngest({
          status: 'ready',
          checksum: '0'.repeat(64),
          processedAt: '2026-04-21T00:00:02.000Z',
        }),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    throw new Error(`Unexpected request: ${url.href}`)
  }) as typeof fetch
}

function forceStaticProgressOutput() {
  Object.defineProperty(stdout, 'isTTY', {
    configurable: true,
    value: false,
  })
}

// -----------------------------------------------------------------------------
// Publish command
// -----------------------------------------------------------------------------

describe('handlePublish', () => {
  test('creates a direct upload intent, uploads the ZIP, and completes the ingest', async () => {
    const cwd = await createPublishFixture()
    const events: string[] = []
    const output: string[] = []

    forceStaticProgressOutput()
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    }
    mockSuccessfulPublish(events)

    await handlePublish({ cwd }, {
      'api-key': 'test-key',
      'api-url': 'https://api.otalan.com',
      channel: 'production',
    })

    expect(events).toEqual([
      'GET https://api.otalan.com/v1/releases/context',
      'POST https://api.otalan.com/v1/releases/create',
      'PUT https://upload.example.test/quarantine.zip',
      'POST https://api.otalan.com/v1/releases/ingests/ingest-123/complete',
      'GET https://api.otalan.com/v1/releases/ingests/ingest-123',
    ])
    expect(output).toEqual([
      '',
      '✓ Preparing',
      '✓ Uploading',
      '✓ Validating',
      '✓ Activating',
      '',
      'Release is Live 🚀',
    ])
  })

  test('prints the detailed publish output when verbose is set', async () => {
    const cwd = await createPublishFixture()
    const events: string[] = []
    const output: string[] = []

    forceStaticProgressOutput()
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(' '))
    }
    mockSuccessfulPublish(events)

    await handlePublish({ cwd }, {
      'api-key': 'test-key',
      'api-url': 'https://api.otalan.com',
      channel: 'production',
      verbose: true,
    })

    const joinedOutput = output.join('\n')

    expect(output).not.toContain('✓ Preparing')
    expect(joinedOutput).toContain('Organization: Test Organization (test-org)')
    expect(joinedOutput).toContain('Project: Mobile App (mobile-app)')
    expect(joinedOutput).toContain('App: Customer Portal (com.example.app)')
    expect(joinedOutput).toContain('Bundle ID: 1.0.0-web.2')
    expect(joinedOutput).toContain('Ingest ID: ingest-123')
    expect(joinedOutput).toContain('Waiting for validation...')
    expect(joinedOutput).toContain('Release is Live 🚀')
    expect(joinedOutput).toContain('Status: ready')
  })

  test('cancels the upload intent when direct object storage upload fails', async () => {
    const cwd = await createProjectFixture()
    const outputDir = path.join(cwd, '.otalan', 'bundle')
    const manifest = {
      target: 'capacitor',
      hash: '0'.repeat(64),
      runtimeVersion: '1.0.0',
      bundleId: '1.0.0-web.3',
      createdAt: '2026-04-21T00:00:00.000Z',
      platform: 'ios',
    }
    const events: string[] = []

    forceStaticProgressOutput()
    await writeFile(path.join(outputDir, 'bundle-1.0.0-web.3.zip'), 'zip-bytes')
    await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    console.log = () => {}

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      events.push(`${init?.method ?? 'GET'} ${url.href}`)

      if (url.pathname === '/v1/releases/context') {
        return createReleaseContextResponse()
      }

      if (url.pathname === '/v1/releases/create') {
        return new Response(JSON.stringify({
          item: createIngest({
            bundleId: '1.0.0-web.3',
            status: 'uploading',
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
      }

      if (url.href === 'https://upload.example.test/quarantine.zip') {
        expect(init?.headers).toEqual({
          'Content-Type': 'application/zip',
          'Content-Length': '9',
        })

        return new Response('<Error>Access Denied</Error>', {
          status: 403,
        })
      }

      if (url.pathname === '/v1/releases/ingests/ingest-123/cancel') {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toEqual({
          'x-api-key': 'test-key',
        })
        expect(init?.body).toBeUndefined()

        return new Response(JSON.stringify({
          item: createIngest({
            bundleId: '1.0.0-web.3',
            status: 'failed',
            failureReason: 'Upload cancelled before completion',
          }),
        }), {
          status: 202,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected request: ${url.href}`)
    }) as typeof fetch

    await expect(handlePublish({ cwd }, {
      'api-key': 'test-key',
      'api-url': 'https://api.otalan.com',
      channel: 'production',
    })).rejects.toThrow('Direct bundle upload failed with status 403')

    expect(events).toEqual([
      'GET https://api.otalan.com/v1/releases/context',
      'POST https://api.otalan.com/v1/releases/create',
      'PUT https://upload.example.test/quarantine.zip',
      'POST https://api.otalan.com/v1/releases/ingests/ingest-123/cancel',
    ])
  })
})
