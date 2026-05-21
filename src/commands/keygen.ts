import { randomBytes } from 'node:crypto'

import { readStringOption } from '../cli/args'
import { promptSelectWithHint } from '../cli/prompts'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const KEY_BYTE_LENGTH = 24

const KEY_KIND_OPTIONS = [
  { label: 'OTA Publish Key', value: 'ci' },
  { label: 'OTA App Key', value: 'ota' },
] as const satisfies ReadonlyArray<{ label: string, value: KeyKind }>

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type KeyKind = 'ci' | 'ota'

export type GeneratedOtalanKey = {
  kind: KeyKind
  prefix: string
  suffix: string
  fullKey: string
}

// -----------------------------------------------------------------------------
// Key helpers
// -----------------------------------------------------------------------------

function resolveKeyPrefix(kind: KeyKind) {
  return kind === 'ci' ? 'otalan_ci' : 'otalan_ota'
}

function resolveKeyKind(value?: string): KeyKind {
  if (value === 'ci' || value === 'ota') {
    return value
  }

  throw new Error('Key kind is required. Use --kind ci or --kind ota.')
}

export function generateOtalanKey(kind: KeyKind, bytes = randomBytes(KEY_BYTE_LENGTH)): GeneratedOtalanKey {
  if (bytes.length !== KEY_BYTE_LENGTH) {
    throw new Error(`Otalan keys must use exactly ${KEY_BYTE_LENGTH} random bytes.`)
  }

  const prefix = resolveKeyPrefix(kind)
  const suffix = bytes.toString('base64url')

  return {
    kind,
    prefix,
    suffix,
    fullKey: `${prefix}_${suffix}`,
  }
}

function formatKeyKindLabel(kind: KeyKind) {
  return kind === 'ci' ? 'OTA Publish Key' : 'OTA App Key'
}

function formatKeygenOutput(key: GeneratedOtalanKey) {
  return [
    `Generated ${formatKeyKindLabel(key.kind)}.`,
    '',
    'Full key:',
    key.fullKey,
    '',
    'Key without prefix:',
    key.suffix,
  ].join('\n')
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export async function handleKeygen(options: Record<string, string | boolean>) {
  const kindOption = readStringOption(options, 'kind')
  const kindInput = kindOption ?? await promptSelectWithHint({
    question: 'Key kind',
    fallback: 'ci',
    hint: 'Generate a local Otalan key. Use OTA Publish Keys for private release automation or OTA App Keys for embedded app update checks.',
    options: KEY_KIND_OPTIONS,
  })
  const key = generateOtalanKey(resolveKeyKind(kindInput))

  console.log(formatKeygenOutput(key))
}

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

export const keygenCommandTestUtils = {
  formatKeygenOutput,
  resolveKeyKind,
  resolveKeyPrefix,
}
