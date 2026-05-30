import { stdout } from 'node:process'

import {
  colorize,
  formatInfo,
  formatLabel,
  formatMuted,
  styleText,
} from './ui'

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, 'g')
const DEFAULT_MAX_WIDTH = 40

type OutputStream = {
  color?: boolean
  isTTY?: boolean
}

type TableColumn = {
  align?: 'left' | 'right'
  header: string
  maxWidth?: number
  minWidth?: number
}

type TableRowTone = 'error' | 'muted' | 'success' | 'warning'

type TableRow = {
  cells: string[]
  tone?: TableRowTone
}

type TableInput = {
  columns: TableColumn[]
  emptyMessage?: string
  rows: TableRow[]
  showHeader?: boolean
  stream?: OutputStream
}

const BORDER = {
  bottom: ['└', '┴', '┘'],
  header: ['├', '┼', '┤'],
  middle: '│',
  row: '│',
  top: ['┌', '┬', '┐'],
} as const

function stripAnsi(value: string) {
  return value.replace(ANSI_PATTERN, '')
}

function visibleLength(value: string) {
  return stripAnsi(value).length
}

function truncateCell(value: string, width: number) {
  if (visibleLength(value) <= width) {
    return value
  }

  const plain = stripAnsi(value)

  if (width <= 1) {
    return '…'
  }

  return `${plain.slice(0, width - 1)}…`
}

function padCell(value: string, width: number, align: 'left' | 'right') {
  const truncated = truncateCell(value, width)
  const padding = ''.padEnd(Math.max(0, width - visibleLength(truncated)), ' ')

  return align === 'right'
    ? `${padding}${truncated}`
    : `${truncated}${padding}`
}

function renderBorder(
  widths: number[],
  pieces: readonly [string, string, string],
  stream: OutputStream,
) {
  const [left, join, right] = pieces
  const line = `${left}${widths.map(width => ''.padEnd(width + 2, '─')).join(join)}${right}`

  return formatMuted(line, stream)
}

function renderRow(input: {
  cells: string[]
  columns: TableColumn[]
  stream: OutputStream
  tone?: TableRowTone
  widths: number[]
}) {
  const border = input.tone
    ? {
      middle: BORDER.middle,
      row: BORDER.row,
    }
    : {
      middle: formatMuted(BORDER.middle, input.stream),
      row: formatMuted(BORDER.row, input.stream),
    }
  const cells = input.cells.map((cell, index) =>
    ` ${padCell(cell, input.widths[index] ?? 0, input.columns[index]?.align ?? 'left')} `,
  )
  const line = `${border.row}${cells.join(border.middle)}${border.row}`

  switch (input.tone) {
    case 'error':
      return colorize(line, 'red', input.stream)
    case 'muted':
      return formatMuted(line, input.stream)
    case 'success':
      return colorize(line, 'green', input.stream)
    case 'warning':
      return colorize(line, 'yellow', input.stream)
    default:
      return line
  }
}

function resolveColumnWidth(input: {
  column: TableColumn
  header: string
  rows: TableRow[]
  index: number
}) {
  const maxContentWidth = Math.max(
    visibleLength(input.header),
    ...input.rows.map(row => visibleLength(row.cells[input.index] ?? '')),
  )
  const maxWidth = input.column.maxWidth ?? DEFAULT_MAX_WIDTH
  const minWidth = input.column.minWidth ?? input.header.length

  return Math.max(minWidth, Math.min(maxWidth, maxContentWidth))
}

export function formatTable(input: TableInput) {
  const stream = input.stream ?? stdout
  const showHeader = input.showHeader ?? true

  if (input.rows.length === 0) {
    return formatInfo(input.emptyMessage ?? 'No rows found.', stream)
  }

  const headers = input.columns.map(column => column.header)
  const widths = input.columns.map((column, index) =>
    resolveColumnWidth({
      column,
      header: headers[index] ?? '',
      index,
      rows: input.rows,
    }),
  )
  const lines = [
    renderBorder(widths, BORDER.top, stream),
  ]

  if (showHeader) {
    lines.push(renderRow({
      cells: headers.map(header => styleText(header, ['bold', 'cyan'], stream)),
      columns: input.columns,
      stream,
      widths,
    }))
    lines.push(renderBorder(widths, BORDER.header, stream))
  }

  for (const row of input.rows) {
    lines.push(renderRow({
      cells: row.cells,
      columns: input.columns,
      stream,
      tone: row.tone,
      widths,
    }))
  }

  lines.push(renderBorder(widths, BORDER.bottom, stream))

  return lines.join('\n')
}

export function printTable(input: TableInput) {
  console.log(formatTable(input))
}

export function formatKeyValueTable(
  rows: Array<[label: string, value: string | number | boolean | null | undefined, tone?: TableRowTone]>,
  input: { stream?: OutputStream } = {},
) {
  return formatTable({
    columns: [
      { header: 'field', maxWidth: 20 },
      { header: 'value', maxWidth: 76 },
    ],
    rows: rows
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([label, value, tone]) => ({
        cells: [formatLabel(label, input.stream ?? stdout), String(value)],
        tone,
      })),
    showHeader: false,
    stream: input.stream,
  })
}
