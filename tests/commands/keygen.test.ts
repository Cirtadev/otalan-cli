import { describe, expect, test } from 'bun:test'

import { generateOtalanKey, keygenCommandTestUtils } from '../../src/commands/keygen'
import { stripAnsi } from '../helpers/ansi'

const KEY_BYTES = Buffer.from(Array.from({ length: 24 }, (_, index) => index))
const KEY_SUFFIX = KEY_BYTES.toString('base64url')

describe('generateOtalanKey', () => {
  test('generates OTA Publish Keys with the Otalan publish prefix and 24 base64url-encoded random bytes', () => {
    const key = generateOtalanKey('ci', KEY_BYTES)

    expect(key).toEqual({
      kind: 'ci',
      prefix: 'otalan_ci',
      suffix: KEY_SUFFIX,
      fullKey: `otalan_ci_${KEY_SUFFIX}`,
    })
    expect(key.suffix).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  test('generates OTA App Keys with the Otalan OTA prefix and 24 base64url-encoded random bytes', () => {
    const key = generateOtalanKey('ota', KEY_BYTES)

    expect(key).toEqual({
      kind: 'ota',
      prefix: 'otalan_ota',
      suffix: KEY_SUFFIX,
      fullKey: `otalan_ota_${KEY_SUFFIX}`,
    })
    expect(key.suffix).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  test('rejects non-24-byte key material', () => {
    expect(() => generateOtalanKey('ci', Buffer.alloc(23))).toThrow(
      'Otalan keys must use exactly 24 random bytes.',
    )
  })
})

describe('keygenCommandTestUtils.resolveKeyKind', () => {
  test('accepts known key kinds', () => {
    expect(keygenCommandTestUtils.resolveKeyKind('ci')).toBe('ci')
    expect(keygenCommandTestUtils.resolveKeyKind('ota')).toBe('ota')
  })

  test('rejects unknown key kinds', () => {
    expect(() => keygenCommandTestUtils.resolveKeyKind('admin')).toThrow(
      'Key kind is required. Use --kind ci or --kind ota.',
    )
  })
})

describe('keygenCommandTestUtils.formatKeygenOutput', () => {
  test('prints the full key and suffix on copyable lines', () => {
    const key = generateOtalanKey('ci', KEY_BYTES)

    expect(stripAnsi(keygenCommandTestUtils.formatKeygenOutput(key))).toBe([
      '✓ Generated OTA Publish Key',
      '',
      '┌────────────────┬────────────────────────────────────────────┐',
      `│ Full key       │ otalan_ci_${KEY_SUFFIX} │`,
      `│ Without prefix │ ${KEY_SUFFIX}           │`,
      '└────────────────┴────────────────────────────────────────────┘',
    ].join('\n'))
  })
})
