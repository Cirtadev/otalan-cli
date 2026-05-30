const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, 'g')

export function stripAnsi(value: string) {
  return value.replace(ANSI_PATTERN, '')
}

export function stripAnsiLines(lines: string[]) {
  return lines.map(stripAnsi)
}
