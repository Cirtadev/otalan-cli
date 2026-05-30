import { stderr, stdout } from 'node:process'

const ANSI_CODES = {
  blue: '\x1B[34m',
  bold: '\x1B[1m',
  cyan: '\x1B[36m',
  dim: '\x1B[2m',
  gray: '\x1B[90m',
  green: '\x1B[32m',
  magenta: '\x1B[35m',
  red: '\x1B[31m',
  reset: '\x1B[0m',
  yellow: '\x1B[33m',
} as const

type Style = Exclude<keyof typeof ANSI_CODES, 'reset'>
type Color = Extract<Style, 'blue' | 'cyan' | 'gray' | 'green' | 'magenta' | 'red' | 'yellow'>

type OutputStream = {
  color?: boolean
  isTTY?: boolean
}

export const UI_SYMBOL = {
  error: '✕',
  info: 'i',
  success: '✓',
  warning: '⚠',
} as const

function shouldUseColor(stream: OutputStream) {
  if (stream.color !== undefined) {
    return stream.color
  }

  if (process.env.OTALAN_NO_COLOR === '1' || process.env.FORCE_COLOR === '0') {
    return false
  }

  return true
}

export function styleText(value: string, styles: Style | Style[], stream: OutputStream = stdout) {
  const selectedStyles = Array.isArray(styles) ? styles : [styles]

  if (!value || !shouldUseColor(stream) || selectedStyles.length === 0) {
    return value
  }

  return `${selectedStyles.map(style => ANSI_CODES[style]).join('')}${value}${ANSI_CODES.reset}`
}

export function colorize(value: string, color: Color, stream: OutputStream = stdout) {
  return styleText(value, color, stream)
}

export function formatHeading(message: string, stream: OutputStream = stdout) {
  return styleText(message, ['bold', 'cyan'], stream)
}

export function formatLabel(message: string, stream: OutputStream = stdout) {
  return styleText(message, 'cyan', stream)
}

export function formatMuted(message: string, stream: OutputStream = stdout) {
  return styleText(message, 'gray', stream)
}

export function formatSuccess(message: string, stream: OutputStream = stdout) {
  return `${colorize(UI_SYMBOL.success, 'green', stream)} ${message}`
}

export function formatError(message: string, stream: OutputStream = stderr) {
  return `${colorize(UI_SYMBOL.error, 'red', stream)} ${message}`
}

export function formatWarning(message: string, stream: OutputStream = stdout) {
  return `${colorize(UI_SYMBOL.warning, 'yellow', stream)} ${message}`
}

export function formatInfo(message: string, stream: OutputStream = stdout) {
  return `${colorize(UI_SYMBOL.info, 'blue', stream)} ${message}`
}

export function printSuccess(message: string) {
  console.log(formatSuccess(message))
}

export function printWarning(message: string) {
  console.warn(formatWarning(message))
}

export function printError(message: string) {
  console.error(formatError(message))
}
