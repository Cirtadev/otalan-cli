import { stdout } from 'node:process'

import { spinner as createClackSpinner } from '@clack/prompts'

import { formatError, formatSuccess } from './ui'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
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

function createInjectedStreamTask(stream: ProgressStream, label: string, intervalMs: number) {
  let frameIndex = 0
  let finished = false
  const render = () => {
    writeAnimatedLine(stream, `${SPINNER_FRAMES[frameIndex]} ${label}`)
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
  }
  const timer = setInterval(render, intervalMs)
  const finish = (line: string) => {
    if (finished) {
      return
    }

    finished = true
    clearInterval(timer)
    writeAnimatedLine(stream, line, true)
  }

  render()

  return {
    succeed: () => finish(formatSuccess(label, stream)),
    fail: () => finish(formatError(label, stream)),
  }
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
          succeed: () => log(formatSuccess(label, stream)),
          fail: () => log(formatError(label, stream)),
        }
      }

      if (input.stream) {
        return createInjectedStreamTask(stream, label, intervalMs)
      }

      const progress = createClackSpinner({
        delay: intervalMs,
        indicator: 'dots',
      })

      progress.start(label)

      return {
        succeed: () => progress.stop(label),
        fail: () => progress.error(label),
      }
    },
  }
}
