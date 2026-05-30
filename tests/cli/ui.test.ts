import { describe, expect, test } from 'bun:test'

import {
  colorize,
  formatError,
  formatInfo,
  formatSuccess,
  formatWarning,
} from '../../src/cli/ui'

describe('terminal UI formatters', () => {
  test('prints compact plain symbols when color is disabled', () => {
    const stream = { color: false }

    expect(formatSuccess('Done', stream)).toBe('✓ Done')
    expect(formatError('Failed', stream)).toBe('✕ Failed')
    expect(formatWarning('Careful', stream)).toBe('⚠ Careful')
    expect(formatInfo('Heads up', stream)).toBe('i Heads up')
  })

  test('adds ANSI colors by default and supports explicit opt out', () => {
    expect(colorize('✓', 'green', { color: true })).toBe('\x1B[32m✓\x1B[0m')
    expect(colorize('✓', 'green', { color: false })).toBe('✓')
  })
})
