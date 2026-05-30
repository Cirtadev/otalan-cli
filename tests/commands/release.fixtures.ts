import { afterEach } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { BundleIngestItem, ReleaseItem } from '../../src/http'

const originalFetch = globalThis.fetch
const originalConsoleLog = console.log

afterEach(() => {
  globalThis.fetch = originalFetch
  console.log = originalConsoleLog
})

export function createIngest(overrides: Partial<BundleIngestItem> = {}): BundleIngestItem {
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

export function createRelease(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    id: 'release-123',
    projectId: 'project-123',
    appId: 'com.example.app',
    platform: 'ios',
    channel: 'production',
    runtimeVersion: '1.0.0',
    bundleId: '1.0.0-web.1',
    releaseStorageId: 'release-storage-123',
    checksum: 'abc123',
    mandatory: true,
    rolloutPercent: 100,
    rolloutState: 'complete',
    releaseNotes: null,
    fileSizeBytes: 1234,
    storageObjectExists: true,
    isActive: false,
    publishedAt: '2026-04-21T00:00:00.000Z',
    resolvedDownloadUrl: 'https://cdn.example.com/ios.zip',
    ...overrides,
  }
}

export async function createProjectFixture() {
  const cwd = path.join(os.tmpdir(), `otalan-cli-release-${crypto.randomUUID()}`)

  await mkdir(cwd, { recursive: true })
  await writeFile(path.join(cwd, 'otalan.config.json'), `${JSON.stringify({
    organizationSlug: 'test-org',
    projectSlug: 'mobile-app',
    appName: 'Customer Portal',
    appId: 'com.example.app',
  }, null, 2)}\n`)

  return cwd
}

export function createReleaseContextResponse() {
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
