/**
 * Log syntax highlighting: tokenizes plain log text (Java / Spring Boot
 * style, but harmless for npm/python output) into colored segments —
 * timestamps, log levels, thread names, fully-qualified class names,
 * exception markers and stack frames. Applied AFTER ANSI parsing, only to
 * text the program did not color itself.
 * @module dsh-better-sidebar-starter/client/logHighlight
 */

/** One highlighted span. */
export interface HighlightSegment {
  text: string
  color?: string
  bold?: boolean
}

// Palette chosen for dark backgrounds (mirrors typical IDE console themes).
const C = {
  ts: '#8f8f98',        // timestamp — muted grey
  thread: '#b48ead',    // [thread-name] — purple
  levelInfo: '#6ab04c', // INFO — green
  levelDebug: '#7a9ce8',// DEBUG — blue
  levelWarn: '#e2b93d', // WARN — yellow
  levelError: '#f0625f',// ERROR/FATAL — red
  clazz: '#61afef',     // com.example.Foo — light blue
  exception: '#ff5f56', // *Exception / Caused by: — red
  frame: '#c678dd',     // at com.foo.Bar(...) — violet
  location: '#56b6c2',  // (Foo.java:123) — cyan
}

/** Log level → color. */
function levelColor(level: string): string {
  switch (level) {
    case 'DEBUG':
    case 'TRACE': return C.levelDebug
    case 'INFO': return C.levelInfo
    case 'WARN': return C.levelWarn
    case 'ERROR':
    case 'FATAL':
    case 'OFF': return C.levelError
    default: return C.levelInfo
  }
}

/** One-pass tokenizer: timestamps, levels, threads, exceptions, stacks, classes. */
const TOKEN_RE = new RegExp([
  // 2026-08-20T17:44:42.123+08:00 | 2026-08-20 17:44:42,123
  '(?<ts>\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}[.,]\\d{1,6}(?:Z|[+-]\\d{2}:?\\d{2})?)',
  // DEBUG / INFO / WARN / ERROR / ...
  '|(?<level>\\b(?:DEBUG|INFO|WARN|ERROR|TRACE|FATAL|OFF)\\b)',
  // [http-nio-8080-exec-1]
  '|(?<thread>\\[[^\\]\\r\\n]+\\])',
  // Caused by: / SQLException / NullPointerException
  '|(?<exception>\\bCaused by:|[A-Z]\\w*(?:Exception|Error)(?:\\b|:\\s))',
  // at com.foo.Bar.method(Foo.java:12) — whole stack frame
  '|(?<frame>\\s+at\\s+[\\w$./<>]+(?:\\([^)]*\\))?)',
  // (Foo.java:123:45)
  '|(?<location>\\([\\w$]+\\.(?:java|kt|groovy|scala):\\d+(?::\\d+)?\\))',
  // com.example.SomeClass (FQCN)
  '|(?<clazz>[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+\\b)',
].join(''), 'g')

/**
 * Tokenize a single log line into highlighted segments.
 * Returns one segment per token; the rest stays plain.
 */
export function highlightLogText(text: string): HighlightSegment[] {
  const out: HighlightSegment[] = []
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    const g = m.groups ?? {}
    if (g.ts !== undefined) {
      out.push({ text: m[0], color: C.ts })
    } else if (g.level !== undefined) {
      out.push({ text: m[0], color: levelColor(g.level), bold: true })
    } else if (g.thread !== undefined) {
      out.push({ text: m[0], color: C.thread })
    } else if (g.exception !== undefined) {
      out.push({ text: m[0], color: C.exception, bold: true })
    } else if (g.frame !== undefined) {
      out.push({ text: m[0], color: C.frame })
    } else if (g.location !== undefined) {
      out.push({ text: m[0], color: C.location })
    } else if (g.clazz !== undefined) {
      out.push({ text: m[0], color: C.clazz })
    } else {
      out.push({ text: m[0] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}