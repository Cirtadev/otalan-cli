import { describe, expect, test } from 'bun:test'

import { promptTestUtils } from '../../src/cli/prompts'

describe('promptTestUtils.formatCompactHint', () => {
  test('formats interactive hints without box padding', () => {
    expect(promptTestUtils.formatCompactHint({
      question: 'Runtime version',
      hint: [
        'Active runtime version: 1.0.2',
        'Press Enter to use the active runtime version.',
      ].join('\n'),
    })).toBe([
      '  Active runtime version: 1.0.2',
      '  Press Enter to use the active runtime version.',
    ].join('\n'))
  })
})

describe('promptTestUtils.resolveSelectPromptAnswer', () => {
  const options = [
    {
      disabled: true,
      label: 'Deleted bundle',
      value: 'deleted',
    },
    {
      label: 'Available bundle',
      value: 'available',
    },
  ]

  test('skips disabled options for numeric answers', () => {
    expect(promptTestUtils.resolveSelectPromptAnswer('1', options)).toBe('available')
  })

  test('does not select disabled options by value', () => {
    expect(promptTestUtils.resolveSelectPromptAnswer('deleted', options)).toBeUndefined()
  })
})

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
