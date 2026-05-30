import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import {
  cancel as cancelPrompt,
  isCancel,
  type Option,
  password,
  select,
  text,
} from '@clack/prompts'

import { formatMuted } from './ui'

type PromptHintInput = {
  question: string
  hint: string
  example?: string
}

export type PromptSelectOption<T extends string> = {
  disabled?: boolean
  hint?: string
  label: string
  value: T
}

export type PromptWithHintInput = PromptHintInput & {
  fallback?: string
  secret?: boolean
}

export type PromptSelectWithHintInput<T extends string> = PromptHintInput & {
  options: readonly PromptSelectOption<T>[]
  fallback?: T
}

type PromptOutput = {
  write: (chunk: string) => unknown
}

const SECRET_INPUT_MASK = '*'

function isInteractiveTerminal() {
  return Boolean(input.isTTY && output.isTTY)
}

function writeSecretInputMask(stream: PromptOutput, value: string) {
  if (!value) {
    return
  }

  stream.write(SECRET_INPUT_MASK.repeat(value.length))
}

function eraseSecretInputMask(stream: PromptOutput) {
  stream.write('\b \b')
}

function formatHint(inputValue: PromptHintInput) {
  return [
    inputValue.hint,
    inputValue.example ? `Example: ${inputValue.example}` : undefined,
  ].filter(Boolean).join('\n')
}

function formatCompactHint(inputValue: PromptHintInput) {
  return formatHint(inputValue)
    .split('\n')
    .filter(Boolean)
    .map(line => `  ${line}`)
    .join('\n')
}

function printHint(inputValue: PromptHintInput) {
  const hint = formatHint(inputValue)

  if (!hint) {
    return
  }

  if (isInteractiveTerminal()) {
    console.log('')
    console.log(formatMuted(formatCompactHint(inputValue)))
    return
  }

  console.log('')
  console.log(inputValue.hint)

  if (inputValue.example) {
    console.log(`Example: ${inputValue.example}`)
  }
}

function assertPromptValue<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancelPrompt('Prompt cancelled.')
    throw new Error('Prompt cancelled.')
  }

  return value
}

async function promptText(question: string, fallback?: string) {
  const rl = readline.createInterface({ input, output })

  try {
    const message = fallback ? `${question} (${fallback}): ` : `${question}: `
    const answer = (await rl.question(message)).trim()
    return answer || fallback || ''
  } finally {
    rl.close()
  }
}

async function promptInteractive(inputValue: PromptWithHintInput) {
  if (inputValue.secret) {
    const answer = assertPromptValue(await password({
      mask: SECRET_INPUT_MASK,
      message: inputValue.question,
    }))

    return answer.trim() || inputValue.fallback || ''
  }

  const answer = assertPromptValue(await text({
    defaultValue: inputValue.fallback,
    initialValue: inputValue.fallback,
    message: inputValue.question,
    placeholder: inputValue.fallback ? undefined : inputValue.example,
  }))

  return answer.trim() || inputValue.fallback || ''
}

export async function promptWithHint(inputValue: PromptWithHintInput) {
  printHint(inputValue)

  if (isInteractiveTerminal()) {
    return promptInteractive(inputValue)
  }

  return promptText(inputValue.question, inputValue.fallback)
}

function resolveSelectPromptAnswer<T extends string>(
  answer: string,
  options: readonly PromptSelectOption<T>[],
  fallback?: T,
) {
  const normalizedAnswer = answer.trim().toLowerCase()
  const selectableOptions = options.filter(option => !option.disabled)

  if (
    !normalizedAnswer
    && fallback
    && selectableOptions.some(option => option.value === fallback)
  ) {
    return fallback
  }

  const numericIndex = Number(normalizedAnswer)

  if (!Number.isNaN(numericIndex)) {
    return selectableOptions[numericIndex - 1]?.value
  }

  return selectableOptions.find(option => (
    option.value.toLowerCase() === normalizedAnswer
    || option.label.toLowerCase() === normalizedAnswer
  ))?.value
}

async function promptSelect<T extends string>(
  question: string,
  options: readonly PromptSelectOption<T>[],
  fallback?: T,
) {
  if (!isInteractiveTerminal()) {
    const selectableOptions = options.filter(option => !option.disabled)
    const choices = selectableOptions
      .map((option, index) => `${index + 1}. ${option.label}`)
      .join(', ')

    if (!choices) {
      throw new Error(`No selectable choices for ${question}.`)
    }

    const answer = await promptText(`${question} (${choices})`, fallback)
    const selectedValue = resolveSelectPromptAnswer(answer, selectableOptions, fallback)

    if (!selectedValue) {
      throw new Error(`Invalid choice for ${question}.`)
    }

    return selectedValue
  }

  return assertPromptValue(await select({
    initialValue: fallback,
    message: question,
    options: options.map(option => ({
      disabled: option.disabled,
      hint: option.hint,
      label: option.label,
      value: option.value,
    })) as Option<T>[],
  }))
}

export async function promptSelectWithHint<T extends string>(inputValue: PromptSelectWithHintInput<T>) {
  printHint(inputValue)
  return promptSelect(inputValue.question, inputValue.options, inputValue.fallback)
}

export const promptTestUtils = {
  eraseSecretInputMask,
  formatCompactHint,
  resolveSelectPromptAnswer,
  writeSecretInputMask,
}
