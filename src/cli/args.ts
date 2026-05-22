export type ParsedArgs = {
  command?: string
  subcommand?: string
  options: Record<string, string | boolean>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, maybeSubcommand, ...restWithMaybeSubcommand] = argv
  const hasSubcommand = command === 'bundles' && Boolean(maybeSubcommand) && !maybeSubcommand.startsWith('-')
  const subcommand = hasSubcommand ? maybeSubcommand : undefined
  const rest = hasSubcommand
    ? restWithMaybeSubcommand
    : [maybeSubcommand, ...restWithMaybeSubcommand].filter(Boolean) as string[]
  const options: Record<string, string | boolean> = {}

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]

    if (!token.startsWith('-')) {
      continue
    }

    if (token.startsWith('--')) {
      const option = token.slice(2)
      const separatorIndex = option.indexOf('=')

      if (separatorIndex !== -1) {
        const key = option.slice(0, separatorIndex)
        options[key] = option.slice(separatorIndex + 1)
        continue
      }

      const key = option
      const next = rest[index + 1]

      if (!next || next.startsWith('-')) {
        options[key] = true
        continue
      }

      options[key] = next
      index += 1
      continue
    }

    if (token.length > 2) {
      for (const flag of token.slice(1)) {
        options[flag] = true
      }

      continue
    }

    const key = token.slice(1)
    options[key] = true
  }

  return { command, subcommand, options }
}

export function readStringOption(options: Record<string, string | boolean>, key: string) {
  const value = options[key]
  return typeof value === 'string' ? value : undefined
}

export function readBooleanOption(options: Record<string, string | boolean>, key: string, fallback = false) {
  const value = options[key]

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value === 'true'
  }

  return fallback
}
