/**
 * ANSI escape code parser: converts raw terminal output with ANSI SGR
 * sequences into an array of styled text segments for React rendering.
 * Covers the common color codes (30-37, 40-47, 90-97, 100-107, bold, dim,
 * italic, underline, reset). Non-SGR escape sequences are stripped.
 * @module dsh-better-sidebar-starter/client/ansi
 */

/** One styled text segment. */
export interface AnsiSegment {
  text: string
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  fg: number | null
  bg: number | null
}

interface ParseState {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  fg: number | null
  bg: number | null
}

function cloneState(s: ParseState): AnsiSegment {
  return {
    text: '',
    bold: s.bold,
    dim: s.dim,
    italic: s.italic,
    underline: s.underline,
    fg: s.fg,
    bg: s.bg,
  }
}

/** Apply one SGR parameter to the parse state. */
function applySgr(state: ParseState, code: number): void {
  if (code === 0) {
    state.bold = false; state.dim = false; state.italic = false
    state.underline = false; state.fg = null; state.bg = null
  } else if (code === 1) {
    state.bold = true
  } else if (code === 2) {
    state.dim = true
  } else if (code === 3) {
    state.italic = true
  } else if (code === 4) {
    state.underline = true
  } else if (code === 22) {
    state.bold = false; state.dim = false
  } else if (code === 23) {
    state.italic = false
  } else if (code === 24) {
    state.underline = false
  } else if (code >= 30 && code <= 37) {
    state.fg = code - 30
  } else if (code === 39) {
    state.fg = null
  } else if (code >= 40 && code <= 47) {
    state.bg = code - 40
  } else if (code === 49) {
    state.bg = null
  } else if (code >= 90 && code <= 97) {
    state.fg = code - 90 + 8
  } else if (code >= 100 && code <= 107) {
    state.bg = code - 100 + 8
  }
}

/**
 * Parse a string with ANSI escape codes into styled segments.
 * Returns an array of AnsiSegment objects ready for React rendering.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const state: ParseState = {
    bold: false, dim: false, italic: false, underline: false, fg: null, bg: null,
  }
  const segments: AnsiSegment[] = []
  let current = cloneState(state)

  // Regex: match CSI sequences (ESC [ ... letter) and non-CSI text.
  const regex = /\x1b\[([0-9;]*)m|\x1b\][^\x07]*\x07|\x1b\[[0-9;]*[A-Za-z]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(input)) !== null) {
    // Text before this escape sequence.
    if (match.index > lastIndex) {
      current.text += input.slice(lastIndex, match.index)
    }
    // Process the escape sequence.
    if (match[1] !== undefined) {
      // SGR sequence: ESC [ ... m
      if (current.text !== '') {
        segments.push(current)
      }
      const params = match[1] === '' ? '0' : match[1]
      for (const codeStr of params.split(';')) {
        const code = codeStr === '' ? 0 : Number(codeStr)
        if (!Number.isNaN(code)) applySgr(state, code)
      }
      current = cloneState(state)
    }
    // Non-SGR sequences (OSC, other CSI) are simply stripped.
    lastIndex = regex.lastIndex
  }

  // Remaining text after the last escape.
  if (lastIndex < input.length) {
    current.text += input.slice(lastIndex)
  }
  if (current.text !== '') {
    segments.push(current)
  }

  return segments
}

/** Map an ANSI color index (0-15) to a CSS color string. */
const ANSI_COLORS: readonly string[] = [
  // 0-7: standard colors
  '#000000', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
  // 8-15: bright colors
  '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
]

/** Resolve a segment's foreground color to a CSS string, or null for default. */
export function segmentFgColor(seg: AnsiSegment): string | null {
  if (seg.fg === null) return null
  return ANSI_COLORS[seg.fg] ?? null
}

/** Resolve a segment's background color to a CSS string, or null for default. */
export function segmentBgColor(seg: AnsiSegment): string | null {
  if (seg.bg === null) return null
  return ANSI_COLORS[seg.bg] ?? null
}
