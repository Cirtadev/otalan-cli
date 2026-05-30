import { afterEach } from 'bun:test'
import { stdout } from 'node:process'

import type { BundleManifest } from '../../src/bundle'
import type { ReleaseItem } from '../../src/http'

const originalFetch = globalThis.fetch
const originalConsoleLog = console.log
const originalConsoleWarn = console.warn
const originalStdoutIsTTY = stdout.isTTY

afterEach(() => {
  globalThis.fetch = originalFetch
  console.log = originalConsoleLog
  console.warn = originalConsoleWarn
  Object.defineProperty(stdout, 'isTTY', {
    configurable: true,
    value: originalStdoutIsTTY,
  })
})

export const MANIFEST = {
  target: 'capacitor',
  hash: 'abc123',
  runtimeVersion: '1.2.3',
  bundleId: '1.2.3-web.4',
  createdAt: '2026-05-04T00:00:00.000Z',
  platform: 'ios',
} as const satisfies BundleManifest

export function createRelease(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
  return {
    id: 'release-123',
    projectId: 'project-123',
    appId: 'com.example.app',
    platform: 'ios',
    channel: 'production',
    runtimeVersion: '1.2.3',
    bundleId: '1.2.3-web.1',
    releaseStorageId: 'release-storage-123',
    checksum: 'abc123',
    mandatory: true,
    rolloutPercent: 100,
    rolloutState: 'complete',
    releaseNotes: null,
    fileSizeBytes: 1234,
    storageObjectExists: true,
    isActive: false,
    publishedAt: '2026-05-04T00:00:00.000Z',
    resolvedDownloadUrl: 'https://cdn.example.com/ios.zip',
    ...overrides,
  }
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

export function forceStaticProgressOutput() {
  Object.defineProperty(stdout, 'isTTY', {
    configurable: true,
    value: false,
  })
}
