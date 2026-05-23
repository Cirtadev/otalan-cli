import { afterEach, describe, expect, test } from 'bun:test'

import {
  formatBundleSummary,
  formatProjectConfigSummary,
  formatReleaseContextSummary,
  printBundlesTable,
  printChannelsTable,
} from '../../src/cli/output'
import type { ReleaseContext, ReleaseItem } from '../../src/http'

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const originalConsoleLog = console.log

afterEach(() => {
  console.log = originalConsoleLog
})

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function createReleaseContext(overrides: Partial<ReleaseContext> = {}): ReleaseContext {
  return {
    organizationId: 'org-123',
    organizationName: 'Test Organization',
    organizationSlug: 'test-org',
    projectId: 'project-123',
    projectName: 'Mobile App',
    projectSlug: 'mobile-app',
    ...overrides,
  }
}

function createRelease(overrides: Partial<ReleaseItem> = {}): ReleaseItem {
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
    rolloutState: 'active',
    releaseNotes: null,
    fileSizeBytes: 1234,
    storageObjectExists: true,
    isActive: true,
    publishedAt: '2026-04-21T00:00:00.000Z',
    resolvedDownloadUrl: 'https://cdn.example.com/bundle.zip',
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// Release context output
// -----------------------------------------------------------------------------

describe('formatReleaseContextSummary', () => {
  test('formats organization and project as two distinct lines', () => {
    expect(formatReleaseContextSummary(createReleaseContext())).toBe([
      'Organization: Test Organization (test-org)',
      'Project: Mobile App (mobile-app)',
    ].join('\n'))
  })

  test('omits duplicate slugs when names and slugs match', () => {
    expect(formatReleaseContextSummary(createReleaseContext({
      organizationName: 'test-org',
      projectName: 'mobile-app',
    }))).toBe([
      'Organization: test-org',
      'Project: mobile-app',
    ].join('\n'))
  })

  test('includes the selected app when provided', () => {
    expect(formatReleaseContextSummary(createReleaseContext(), {
      name: 'Customer Portal',
      appId: 'com.example.app',
    })).toBe([
      'Organization: Test Organization (test-org)',
      'Project: Mobile App (mobile-app)',
      'App: Customer Portal (com.example.app)',
    ].join('\n'))
  })
})

describe('formatProjectConfigSummary', () => {
  test('prints the locally linked project and app', () => {
    expect(formatProjectConfigSummary({
      organizationSlug: 'test-org',
      projectSlug: 'mobile-app',
      appName: 'Customer Portal',
      appId: 'com.example.app',
    })).toBe([
      'Organization: test-org',
      'Project: mobile-app',
      'App: Customer Portal (com.example.app)',
    ].join('\n'))
  })
})

describe('formatBundleSummary', () => {
  test('prints the bundle publishedAt timestamp', () => {
    expect(formatBundleSummary({
      bundleId: '1.0.0-web.2',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      publishedAt: '2026-04-22T00:00:00.000Z',
    })).toContain('Published at: 2026-04-22T00:00:00.000Z')
  })
})

describe('printBundlesTable', () => {
  test('marks truncated cells with an ellipsis', () => {
    const lines: string[] = []

    console.log = (...values: unknown[]) => {
      lines.push(values.map(String).join(' '))
    }

    printBundlesTable([
      createRelease({
        bundleId: 'bundle-id-that-is-longer-than-thirty-two-characters',
      }),
    ])

    expect(lines.join('\n')).toContain('bundle-id-that-is-longer-than-t…')
  })
})

describe('printChannelsTable', () => {
  test('prints a channel table', () => {
    const lines: string[] = []
    const longApp = 'capacitor8 (com.otalan.capacitor8)'

    console.log = (...values: unknown[]) => {
      lines.push(values.map(String).join(' '))
    }

    printChannelsTable([
      {
        channel: 'production',
        apps: [
          {
            appId: 'com.example.app',
            name: 'Example App',
          },
          {
            appId: 'com.otalan.capacitor7',
            name: 'capacitor7',
          },
          {
            appId: 'com.otalan.capacitor8',
            name: 'capacitor8',
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
    ])

    expect(lines.join('\n')).toContain('channel')
    expect(lines.join('\n')).toContain('apps')
    expect(lines.join('\n')).toContain('production')
    expect(lines.join('\n')).toContain('Example App (com.example.app)')
    expect(lines.join('\n')).toContain(longApp)
    expect(lines.join('\n')).not.toContain('…')
    expect(lines.join('\n')).toContain('staging')
  })

  test('prints an empty state when no channels exist', () => {
    const lines: string[] = []

    console.log = (...values: unknown[]) => {
      lines.push(values.map(String).join(' '))
    }

    printChannelsTable([])

    expect(lines).toEqual(['No channels found.'])
  })
})
