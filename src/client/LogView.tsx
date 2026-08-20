/**
 * Log view: the right pane showing real-time log output from a running
 * instance. Connects to the WebSocket endpoint, parses ANSI colors, and
 * renders log lines with auto-scroll.
 * @module dsh-better-sidebar-starter/client/LogView
 */

import { createElement, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import type { LogEntry, RunInstance } from './types.ts'
import type { WsMessage } from './types.ts'
import { parseAnsi, segmentFgColor, segmentBgColor, type AnsiSegment } from './ansi.ts'
import { StopIcon, RestartIcon, TrashIcon } from './icons.tsx'

/** Props for the log view. */
export interface LogViewProps {
  instance: RunInstance
  onStop: () => void
  onRestart: () => void
}

/** One rendered log line. */
interface LogLine {
  entries: LogEntry[]
  key: number
}

/** Render ANSI-colored text segments. */
function renderAnsiLine(text: string, keyBase: string): ReactNode {
  const segments = parseAnsi(text)
  return segments.map((seg: AnsiSegment, i: number) => {
    const style: Record<string, string> = {}
    const fg = segmentFgColor(seg)
    const bg = segmentBgColor(seg)
    if (fg !== null) style.color = fg
    if (bg !== null) style.backgroundColor = bg
    if (seg.bold) style.fontWeight = 'bold'
    if (seg.dim) style.opacity = '0.6'
    if (seg.italic) style.fontStyle = 'italic'
    if (seg.underline) style.textDecoration = 'underline'
    return createElement('span', { key: `${keyBase}-${i}`, style }, seg.text)
  })
}

/** The log view component. */
export function LogView({ instance, onStop, onRestart }: LogViewProps): ReactNode {
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [exitInfo, setExitInfo] = useState<{ status: string; exitCode: number | null } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const lineKeyCounter = useRef(0)

  // Buffer accumulation: accumulate text entries into complete lines.
  const lineBuffer = useRef<{ current: LogEntry[] }>({ current: [] })

  /** Flush the buffer into a new log line. */
  const flushLine = useCallback((): void => {
    const entries = lineBuffer.current.current
    if (entries.length === 0) return
    lineBuffer.current.current = []
    setLogLines((prev) => {
      const key = lineKeyCounter.current++
      // Cap at 5000 lines to avoid memory issues.
      const next = [...prev, { entries, key }]
      if (next.length > 5000) next.splice(0, next.length - 5000)
      return next
    })
  }, [])

  /** Add an entry to the current line buffer, splitting on newlines. */
  const addEntry = useCallback((entry: LogEntry): void => {
    const parts = entry.text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        // Newline boundary: flush the current line.
        flushLine()
      }
      if (parts[i] !== '') {
        lineBuffer.current.current.push({
          stream: entry.stream,
          text: parts[i],
          ts: entry.ts,
        })
      }
    }
    // If the entry ends with \n, flush.
    if (parts.length > 1 && parts[parts.length - 1] === '') {
      flushLine()
    }
  }, [flushLine])

  // Connect WebSocket.
  useEffect(() => {
    const url = `/api/dsh-better-sidebar-starter/logs?instanceId=${encodeURIComponent(instance.id)}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (event: MessageEvent): void => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage
        if (msg.type === 'history') {
          setLogLines([])
          lineBuffer.current.current = []
          for (const entry of msg.entries) {
            addEntry(entry)
          }
          flushLine()
        } else if (msg.type === 'log') {
          addEntry(msg.entry)
        } else if (msg.type === 'status') {
          if (msg.status !== 'running') {
            flushLine()
            setExitInfo({ status: msg.status, exitCode: msg.exitCode })
          }
        }
      } catch { /* ignore parse errors */ }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [instance.id, addEntry, flushLine])

  // Auto-scroll to bottom when new lines arrive.
  useEffect(() => {
    if (autoScroll && contentRef.current !== null) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [logLines, autoScroll])

  const handleClear = (): void => {
    setLogLines([])
    lineBuffer.current.current = []
  }

  return createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    // Toolbar
    createElement('div', { className: 'sts-log-toolbar' },
      instance.configName,
      createElement('span', { style: { opacity: 0.5, marginLeft: '4px' } }, `#${instance.id.slice(0, 8)}`),
      createElement('div', { className: 'sts-log-toolbar-spacer' }),
      instance.status === 'running'
        ? createElement('button', {
            className: 'sts-icon-btn stop',
            title: '停止',
            onClick: onStop,
          }, StopIcon({ size: 14 }), ' 停止')
        : null,
      createElement('button', {
        className: 'sts-icon-btn',
        title: '重启',
        onClick: onRestart,
      }, RestartIcon({ size: 14 }), ' 重启'),
      createElement('button', {
        className: 'sts-icon-btn',
        title: '清空',
        onClick: handleClear,
      }, TrashIcon({ size: 14 }), ' 清空'),
      createElement('label', {
        className: 'sts-log-toolbar-label',
        onClick: () => setAutoScroll((v) => !v),
      },
        autoScroll ? '☑' : '☐',
        ' 自动滚动',
      ),
    ),
    // Log content
    createElement('div', { ref: contentRef, className: 'sts-log-content' },
      ...logLines.map((line) => {
        const keyStr = `line-${line.key}`
        return createElement('div', { key: keyStr, className: 'sts-log-line' },
          ...line.entries.map((entry, i) => {
            const segKey = `${keyStr}-e${i}`
            return createElement('span', {
              key: segKey,
              className: entry.stream === 'stderr' ? 'sts-log-stderr' : '',
            }, renderAnsiLine(entry.text, segKey))
          }),
        )
      }),
      // Exit info
      exitInfo !== null
        ? createElement('div', {
            key: 'exit-info',
            style: {
              color: exitInfo.status === 'exited' && exitInfo.exitCode === 0 ? '#4e9a06' : '#cc0000',
              fontWeight: 'bold',
              marginTop: '4px',
            },
          },
            `\n进程${exitInfo.status === 'exited' ? '退出' : exitInfo.status === 'killed' ? '被终止' : '出错'}`,
            exitInfo.exitCode !== null ? `，退出码: ${exitInfo.exitCode}` : '',
          )
        : null,
    ),
  )
}
