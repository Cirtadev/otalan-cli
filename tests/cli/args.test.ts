import { describe, expect, test } from 'bun:test'

import { parseArgs, readBooleanOption, readStringOption } from '../../src/cli/args'

// -----------------------------------------------------------------------------
// parseArgs
// -----------------------------------------------------------------------------

describe('parseArgs', () => {
  test('parses long options with values for bundles subcommands', () => {
    const parsed = parseArgs([
      'bundles',
      'ls',
      '--platform',
      'ios',
      '--channel',
      'production',
    ])

    expect(parsed).toEqual({
      command: 'bundles',
      subcommand: 'ls',
      options: {
        platform: 'ios',
        channel: 'production',
      },
    })
  })

  test('parses grouped short flags as booleans', () => {
    const parsed = parseArgs(['help', '-hv'])

    expect(parsed.command).toBe('help')
    expect(parsed.options).toEqual({
      h: true,
      v: true,
    })
  })
})

// -----------------------------------------------------------------------------
// option readers
// -----------------------------------------------------------------------------

describe('option readers', () => {
  test('reads string options only when the value is a string', () => {
    expect(readStringOption({ platform: 'ios' }, 'platform')).toBe('ios')
    expect(readStringOption({ help: true }, 'help')).toBeUndefined()
  })

  test('reads boolean options from booleans, strings, and fallbacks', () => {
    expect(readBooleanOption({ optional: true }, 'optional')).toBe(true)
    expect(readBooleanOption({ optional: 'true' }, 'optional')).toBe(true)
    expect(readBooleanOption({ optional: 'false' }, 'optional')).toBe(false)
    expect(readBooleanOption({}, 'optional', true)).toBe(true)
  })
})
