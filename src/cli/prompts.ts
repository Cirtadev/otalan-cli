import readline from 'node:readline/promises'
import {
  clearLine,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
} from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'

// -----------------------------------------------------------------------------
// ANSI styles
// -----------------------------------------------------------------------------

const ANSI_RESET = '\u001B[0m'
const ANSI_BOLD = '\u001B[1m'
const ANSI_CYAN = '\u001B[36m'

// -----------------------------------------------------------------------------
// Shared types
// -----------------------------------------------------------------------------

type PromptHintInput = {
  question: string
  hint: string
  example?: string
}

export type PromptSelectOption<T extends string> = {
  label: string
  value: T
}

export type PromptWithHintInput = PromptHintInput & {
  fallback?: string
}

export type PromptSelectWithHintInput<T extends string> = PromptHintInput & {
  options: readonly PromptSelectOption<T>[]
  fallback?: T
}

// -----------------------------------------------------------------------------
// Text prompt helpers
// -----------------------------------------------------------------------------

async function prompt(question: string, fallback?: string) {
  const rl = readline.createInterface({ input, output })

  try {
    const message = fallback ? `${question} (${fallback}): ` : `${question}: `
    const answer = (await rl.question(message)).trim()
    return answer || fallback || ''
  } finally {
    rl.close()
  }
}

function printHint(inputValue: PromptHintInput) {
  console.log('')
  console.log(inputValue.hint)

  if (inputValue.example) {
    console.log(`Example: ${inputValue.example}`)
  }
}

export async function promptWithHint(input: PromptWithHintInput) {
  printHint(input)
  return prompt(input.question, input.fallback)
}

// -----------------------------------------------------------------------------
// Select prompt helpers
// -----------------------------------------------------------------------------

function resolveSelectPromptAnswer<T extends string>(
  answer: string,
  options: readonly PromptSelectOption<T>[],
  fallback?: T,
) {
  const normalizedAnswer = answer.trim().toLowerCase()

  if (!normalizedAnswer && fallback) {
    return fallback
  }

  const numericIndex = Number(normalizedAnswer)

  if (!Number.isNaN(numericIndex)) {
    return options[numericIndex - 1]?.value
  }

  return options.find(option => (
    option.value.toLowerCase() === normalizedAnswer
    || option.label.toLowerCase() === normalizedAnswer
  ))?.value
}

function clearRenderedBlock(lineCount: number) {
  if (lineCount < 1) {
    return
  }

  moveCursor(output, 0, -lineCount)

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    clearLine(output, 0)
    cursorTo(output, 0)

    if (lineIndex < lineCount - 1) {
      moveCursor(output, 0, 1)
    }
  }

  moveCursor(output, 0, -(lineCount - 1))
}

function styleSelectedOption(label: string) {
  return `${ANSI_CYAN}${ANSI_BOLD}› ● ${label}${ANSI_RESET}`
}

function styleUnselectedOption(label: string) {
  return `  ○ ${label}`
}

async function promptSelect<T extends string>(
  question: string,
  options: readonly PromptSelectOption<T>[],
  fallback?: T,
) {
  const fallbackIndex = fallback
    ? Math.max(options.findIndex(option => option.value === fallback), 0)
    : 0

  if (!input.isTTY || !output.isTTY) {
    const choices = options
      .map((option, index) => `${index + 1}. ${option.label}`)
      .join(', ')
    const answer = await prompt(`${question} (${choices})`, fallback)
    const selectedValue = resolveSelectPromptAnswer(answer, options, fallback)

    if (!selectedValue) {
      throw new Error(`Invalid choice for ${question}.`)
    }

    return selectedValue
  }

  return new Promise<T>((resolve, reject) => {
    let renderedLineCount = 0
    let selectedIndex = fallbackIndex
    const previousRawMode = input.isRaw

    const render = () => {
      if (renderedLineCount > 0) {
        clearRenderedBlock(renderedLineCount)
      }

      const lines = [
        `${ANSI_BOLD}${question}:${ANSI_RESET}`,
        'Use arrow keys and press Enter.',
        ...options.map((option, index) => (
          selectedIndex === index
            ? styleSelectedOption(option.label)
            : styleUnselectedOption(option.label)
        )),
      ]

      output.write(`${lines.join('\n')}\n`)
      renderedLineCount = lines.length
    }

    const cleanup = () => {
      input.off('keypress', onKeypress)
      input.setRawMode(previousRawMode)
      input.pause()
    }

    const finish = (value: T) => {
      clearRenderedBlock(renderedLineCount)
      cleanup()
      output.write(`${question}: ${options[selectedIndex]?.label ?? value}\n`)
      resolve(value)
    }

    const cancel = () => {
      clearRenderedBlock(renderedLineCount)
      cleanup()
      reject(new Error('Prompt cancelled.'))
    }

    const onKeypress = (_text: string, key: { ctrl?: boolean, name?: string }) => {
      if (key.ctrl && key.name === 'c') {
        cancel()
        return
      }

      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length
        render()
        return
      }

      if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % options.length
        render()
        return
      }

      if (key.name === 'return' || key.name === 'enter') {
        finish(options[selectedIndex].value)
      }
    }

    emitKeypressEvents(input)
    input.setRawMode(true)
    input.resume()
    input.on('keypress', onKeypress)
    render()
  })
}

export async function promptSelectWithHint<T extends string>(inputValue: PromptSelectWithHintInput<T>) {
  printHint(inputValue)
  return promptSelect(inputValue.question, inputValue.options, inputValue.fallback)
}
