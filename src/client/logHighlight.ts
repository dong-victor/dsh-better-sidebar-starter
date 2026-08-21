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
  /** Source-code navigation target (makes the span clickable). */
  link?: LogCodeLink
}

/** A clickable source reference parsed out of the log line. */
export interface LogCodeLink {
  kind: 'class' | 'frame' | 'location'
  /** Fully-qualified class name (dots), e.g. com.example.service.UserService. */
  className?: string
  /** Source file base name, e.g. UserService.java. */
  file?: string
  /** Method name from a stack frame, e.g. getUser ('' for constructors). */
  method?: string
  /** 1-based line (from a stack frame / (File.java:45) token). */
  line?: number
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
  '|(?<frame>\\s+at\\s+(?<target>[\\w$./<>]+)(?:\\((?<loc>[^)]*)\\))?)',
  // (Foo.java:123:45)
  '|(?<location>\\((?<lfile>[\\w$]+\\.(?:java|kt|groovy|scala)):(?<lline>\\d+)(?::\\d+)?\\))',
  // pkg.Cls.method(...) — a method CALL in the message text
  '|(?<call>(?<callCls>[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+)\\.(?<callMethod>[A-Za-z_$][\\w$]*)\\s*\\()',
  // com.example.SomeClass (FQCN)
  '|(?<clazz>[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+\\b)',
].join(''), 'g')

/** The last segment must look like a class name (starts uppercase); field
 *  chains such as System.out are skipped. */
function looksLikeClassName(fqcn: string): boolean {
  const last = fqcn.split('.').pop() ?? ''
  return last !== '' && /^[A-Z]/.test(last)
}

/** Split a stack-frame target `pkg.Cls.method` into class + method. */
function parseFrameTarget(target: string): { className: string; method: string } {
  const dot = target.lastIndexOf('.')
  if (dot > 0 && dot < target.length - 1) {
    return { className: target.slice(0, dot), method: target.slice(dot + 1) }
  }
  return { className: target, method: '' }
}

/** Parse a `File.java:45` (or `File.java:45:12`) location string. */
function parseFrameLoc(loc: string | undefined): { file?: string; line?: number } {
  if (loc === undefined || loc.trim() === '') return {}
  const parts = loc.trim().split(':')
  if (parts.length < 2) return {}
  const line = Number(parts[1])
  return { file: parts[0], line: Number.isInteger(line) && line > 0 ? line : undefined }
}

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
      const { className, method } = parseFrameTarget(g.target ?? '')
      const { file, line } = parseFrameLoc(g.loc)
      out.push({
        text: m[0],
        color: C.frame,
        link: { kind: 'frame', className, method, file, line },
      })
    } else if (g.location !== undefined) {
      out.push({
        text: m[0],
        color: C.location,
        link: {
          kind: 'location',
          file: g.lfile,
          line: Number(g.lline),
        },
      })
    } else if (g.call !== undefined) {
      const className = g.callCls ?? ''
      out.push({
        text: m[0],
        color: C.clazz,
        link: looksLikeClassName(className)
          ? { kind: 'class', className, method: g.callMethod ?? '' }
          : undefined,
      })
    } else if (g.clazz !== undefined) {
      const className = g.clazz
      out.push({
        text: m[0],
        color: C.clazz,
        link: looksLikeClassName(className) ? { kind: 'class', className } : undefined,
      })
    } else {
      out.push({ text: m[0] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}