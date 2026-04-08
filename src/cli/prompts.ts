import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

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

export type PromptWithHintInput = {
  question: string
  hint: string
  example?: string
  fallback?: string
}

export async function promptWithHint(input: PromptWithHintInput) {
  console.log('')
  console.log(input.hint)

  if (input.example) {
    console.log(`Example: ${input.example}`)
  }

  return prompt(input.question, input.fallback)
}
