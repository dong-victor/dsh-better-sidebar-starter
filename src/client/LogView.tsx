/**
 * Log view: the right pane showing real-time log output from a running
 * instance. Connects to the WebSocket endpoint, parses ANSI colors, and
 * renders log lines with auto-scroll.
 * @module dsh-better-sidebar-starter/client/LogView
 */

import { createElement, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import type { Context } from 'cordis'
import type { LogEntry, RunInstance } from './types.ts'
import type { WsMessage } from './types.ts'
import { parseAnsi, segmentFgColor, segmentBgColor, type AnsiSegment } from './ansi.ts'
import { highlightLogText, type LogCodeLink } from './logHighlight.ts'
import { StopIcon, RestartIcon, TrashIcon, SendToChatIcon } from './icons.tsx'
import { appendToDraft } from './conversationDraft.ts'
import { showToast } from './utils.ts'

/** API base. */
const API_BASE = '/api/dsh-better-sidebar-starter'

/** Structural face of ctx.betterSidebar (openFile only). */
interface BetterSidebarLike {
  openFile(scope: { sessionId: string; cwd?: string }, path: string, title?: string): void
}

/** Props for the log view. */
export interface LogViewProps {
  instance: RunInstance
  /** The sidebar tab's cordis context (used to reach the conversation service). */
  ctx: Context
  /** The session to send selected text into. */
  sessionId: string
  /** Session working directory (for locating source files / openFile scope). */
  cwd?: string
  onStop: () => void
  onRestart: () => void
}

/** One rendered log line. */
export interface LogLine {
  entries: LogEntry[]
  key: number
}

/** Structural face of ctx.betterSidebar (openFile only). */
interface BetterSidebarLike {
  openFile(scope: { sessionId: string; cwd?: string }, path: string, title?: string): void
}

/** Open the source behind a log token via the locate-source API. Shared by the
 *  live LogView and the persisted LogHistoryView. `root` is the locating root
 *  (live instance cwd, or the session workspace for history logs). */
export async function handleLogCodeClick(
  ctx: Context,
  sessionId: string,
  cwd: string | undefined,
  root: string | undefined,
  link: LogCodeLink,
): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (root !== undefined && root !== '') payload.root = root
  if (link.kind === 'class' || link.kind === 'frame') payload.className = link.className
  if (link.file !== undefined) payload.file = link.file
  if (link.method !== undefined && link.method !== '<init>' && link.method !== '<clinit>') payload.method = link.method
  if (link.line !== undefined) payload.line = link.line
  try {
    // The host resolves the session cwd from the query — sessionId is required.
    const params = new URLSearchParams({ sessionId })
    if (cwd !== undefined && cwd !== '') params.set('cwd', cwd)
    const resp = await fetch(`${API_BASE}/locate-source?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      // Surface the host's error message (e.g. missing sessionId) instead
      // of a generic failure.
      let reason = '定位源码失败'
      try {
        const err = await resp.json() as { error?: string }
        if (typeof err.error === 'string' && err.error !== '') reason = err.error
      } catch { /* non-JSON error body — keep generic message */ }
      showToast(reason, false)
      return
    }
    const data = await resp.json() as { ok: boolean; path?: string; line?: number; decompiled?: boolean; reason?: string }
    if (data.ok !== true || typeof data.path !== 'string') {
      showToast(data.reason ?? '未找到源文件', false)
      return
    }
    const base = data.path.split(/[\\/]/).pop() ?? data.path
    const line = typeof data.line === 'number' ? data.line : undefined
    const decompiled = data.decompiled === true
    const badge = decompiled ? ' [反编译]' : ''
    const title = line !== undefined ? `${base} : ${line}${badge}` : `${base}${badge}`
    const betterSidebar = (ctx as { betterSidebar?: BetterSidebarLike }).betterSidebar
    // Open in the session's sidebar editor.
    if (betterSidebar !== undefined) {
      betterSidebar.openFile({ sessionId, cwd }, data.path, title)
    }
    // Copy "File.java:line" so the user can jump in an unsupported editor.
    try {
      void navigator.clipboard?.writeText(`${base}${line !== undefined ? `:${line}` : ''}`)
    } catch { /* clipboard unavailable — ignore */ }
    showToast(
      line !== undefined
        ? `已打开 ${base}，定位到第 ${line} 行（已复制 ${base}:${line}）${decompiled ? '（反编译产物）' : ''}`
        : decompiled
          ? `已打开反编译产物 ${base}`
          : `已打开 ${base}`,
      true,
    )
  } catch {
    showToast('定位源码失败', false)
  }
}

/** Render ANSI-colored text segments, applying Java-log syntax highlighting
 *  to text the program did not color itself (ANSI-colored spans keep the
 *  program's own colors). Tokens with a source link become clickable. */
export function renderAnsiLine(text: string, keyBase: string, onLinkClick: (link: LogCodeLink) => void): ReactNode {
  const segments = parseAnsi(text)
  const nodes: ReactNode[] = []
  let hlCounter = 0
  for (let i = 0; i < segments.length; i++) {
    const seg: AnsiSegment = segments[i]
    const fg = segmentFgColor(seg)
    const bg = segmentBgColor(seg)
    // Style carried from the ANSI segment (bold/dim/italic/underline).
    const baseStyle: Record<string, string> = {}
    if (seg.bold) baseStyle.fontWeight = 'bold'
    if (seg.dim) baseStyle.opacity = '0.6'
    if (seg.italic) baseStyle.fontStyle = 'italic'
    if (seg.underline) baseStyle.textDecoration = 'underline'

    if (fg !== null || bg !== null) {
      // Program-colored text: keep the raw output as-is.
      const style: Record<string, string> = { ...baseStyle }
      if (fg !== null) style.color = fg
      if (bg !== null) style.backgroundColor = bg
      nodes.push(createElement('span', { key: `${keyBase}-${i}`, style }, seg.text))
    } else {
      // Uncolored text: run the log syntax highlighter.
      const hl = highlightLogText(seg.text)
      for (const h of hl) {
        const style: Record<string, string> = { ...baseStyle }
        if (h.color !== undefined) style.color = h.color
        if (h.bold === true) style.fontWeight = 'bold'
        nodes.push(createElement('span', {
          key: `${keyBase}-${i}-hl${hlCounter++}`,
          className: h.link !== undefined ? 'sts-log-link' : undefined,
          style,
          onClick: h.link !== undefined
            ? (e: MouseEvent) => {
                e.stopPropagation()
                onLinkClick(h.link!)
              }
            : undefined,
        }, h.text))
      }
    }
  }
  return nodes
}

/** The log view component. */
export function LogView({ instance, ctx, sessionId, cwd, onStop, onRestart }: LogViewProps): ReactNode {
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [exitInfo, setExitInfo] = useState<{ status: string; exitCode: number | null } | null>(null)
  const [selLength, setSelLength] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const lineKeyCounter = useRef(0)

  // Track the length of the current text selection inside this panel.
  useEffect(() => {
    const updateSel = (): void => {
      const sel = window.getSelection()
      const len = sel !== null && !sel.isCollapsed ? sel.toString().trim().length : 0
      setSelLength(len)
    }
    document.addEventListener('selectionchange', updateSel)
    return () => document.removeEventListener('selectionchange', updateSel)
  }, [])

  /** Send the currently selected log text into the conversation composer. */
  const handleSendSelection = (): void => {
    const sel = window.getSelection()
    const text = sel !== null && !sel.isCollapsed ? sel.toString().trim() : ''
    if (text === '') {
      showToast('请先在日志中选中文本', false)
      return
    }
    if (appendToDraft(ctx, sessionId, text)) {
      showToast(`已将选中文本（${text.length} 字符）发送到对话`, true)
    } else {
      showToast('发送失败：对话服务不可用', false)
    }
  }

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
          }, StopIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, '停止'))
        : null,
      createElement('button', {
        className: 'sts-icon-btn',
        title: '重启',
        onClick: onRestart,
      }, RestartIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, '重启')),
      createElement('button', {
        className: 'sts-icon-btn',
        title: '清空',
        onClick: handleClear,
      }, TrashIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, '清空')),
      createElement('button', {
        className: 'sts-icon-btn send',
        title: selLength > 0 ? `发送选中的 ${selLength} 字符到对话` : '发送选中的文本到对话',
        onClick: handleSendSelection,
      }, SendToChatIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, selLength > 0 ? `发送选中(${selLength})` : '发送选中')),
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
            }, renderAnsiLine(entry.text, segKey, (link) => { void handleLogCodeClick(ctx, sessionId, cwd, instance.cwd, link) }))
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
