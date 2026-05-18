import { describe, expect, test } from 'bun:test'

import { formatBundleSummary, formatReleaseContextSummary } from '../../src/cli/output'
import type { ReleaseContext } from '../../src/http'

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
