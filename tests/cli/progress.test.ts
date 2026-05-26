import { describe, expect, test } from 'bun:test'

import { createProgressReporter } from '../../src/cli/progress'

describe('createProgressReporter', () => {
  test('prints stable progress lines when animation is disabled', () => {
    const output: string[] = []
    const progress = createProgressReporter({
      animated: false,
      log: line => output.push(line),
    })

    progress.start('Uploading').succeed()
    progress.start('Validating').fail()

    expect(output).toEqual([
      '✓ Uploading',
      '✕ Validating',
    ])
  })

  test('rewrites animated progress with colored terminal results', () => {
    const chunks: string[] = []
    const progress = createProgressReporter({
      animated: true,
      intervalMs: 60_000,
      stream: {
        isTTY: true,
        write: chunk => {
          chunks.push(chunk)
        },
      },
    })

    progress.start('Uploading').succeed()
    progress.start('Validating').fail()

    const output = chunks.join('')

    expect(output).toContain('⠋ Uploading')
    expect(output).toContain('\x1B[32m✓\x1B[0m Uploading\n')
    expect(output).toContain('⠋ Validating')
    expect(output).toContain('\x1B[31m✕\x1B[0m Validating\n')
  })
})
