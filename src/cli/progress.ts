import { stdout } from 'node:process'

// -----------------------------------------------------------------------------
// Progress output
// -----------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const ANSI_GREEN = '\x1B[32m'
const ANSI_RED = '\x1B[31m'
const ANSI_RESET = '\x1B[0m'
const ANSI_CLEAR_LINE = '\r\x1B[2K'
const DEFAULT_INTERVAL_MS = 80

type ProgressStream = {
  isTTY?: boolean
  write: (chunk: string) => unknown
}

export type ProgressTask = {
  succeed: () => void
  fail: () => void
}

type ProgressReporterInput = {
  animated?: boolean
  intervalMs?: number
  log?: (line: string) => void
  stream?: ProgressStream
}

function writeAnimatedLine(stream: ProgressStream, line: string, newline = false) {
  stream.write(`${ANSI_CLEAR_LINE}${line}${newline ? '\n' : ''}`)
}

export function createProgressReporter(input: ProgressReporterInput = {}) {
  const stream = input.stream ?? stdout
  const log = input.log ?? console.log
  const animated = input.animated ?? Boolean(stream.isTTY)
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS

  return {
    start(label: string): ProgressTask {
      if (!animated) {
        return {
          succeed: () => log(`✓ ${label}`),
          fail: () => log(`✕ ${label}`),
        }
      }

      let frameIndex = 0
      let finished = false
      const render = () => {
        writeAnimatedLine(stream, `${SPINNER_FRAMES[frameIndex]} ${label}`)
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
      }
      const timer = setInterval(render, intervalMs)
      const finish = (symbol: string, color: string) => {
        if (finished) {
          return
        }

        finished = true
        clearInterval(timer)
        writeAnimatedLine(stream, `${color}${symbol}${ANSI_RESET} ${label}`, true)
      }

      render()

      return {
        succeed: () => finish('✓', ANSI_GREEN),
        fail: () => finish('✕', ANSI_RED),
      }
    },
  }
}
