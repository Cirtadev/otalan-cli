import { describe, expect, test } from 'bun:test'

import { promptTestUtils } from '../../src/cli/prompts'

describe('promptTestUtils.writeSecretInputMask', () => {
  test('writes one mask character per typed character', () => {
    const chunks: string[] = []

    promptTestUtils.writeSecretInputMask({
      write: chunk => chunks.push(chunk),
    }, 'abc')

    expect(chunks).toEqual(['***'])
  })

  test('does not write mask output for empty input', () => {
    const chunks: string[] = []

    promptTestUtils.writeSecretInputMask({
      write: chunk => chunks.push(chunk),
    }, '')

    expect(chunks).toEqual([])
  })
})

describe('promptTestUtils.eraseSecretInputMask', () => {
  test('erases the previous mask character', () => {
    const chunks: string[] = []

    promptTestUtils.eraseSecretInputMask({
      write: chunk => chunks.push(chunk),
    })

    expect(chunks).toEqual(['\b \b'])
  })
})
