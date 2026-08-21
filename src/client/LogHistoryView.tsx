/**
 * Log history view: read-only viewer for persisted run logs
 * (`GET /logs-history`). Two states: the file list under the workspace's
 * `.dsh/logs` directory, and the rendered content of one log file. Reuses
 * the LogView line renderer (ANSI + Java-log highlighting + code links),
 * so previous runs — including failed spawns — stay inspectable forever.
 * @module dsh-better-sidebar-starter/client/LogHistoryView
 */

import { createElement, useState, useRef, useCallback, type ReactNode } from 'react'
import type { Context } from 'cordis'
import type { LogEntry } from './types.ts'
import { renderAnsiLine, handleLogCodeClick, type LogLine } from './LogView.tsx'
import { BackIcon, CloseIcon, FileIcon, TrashIcon, RefreshIcon } from './icons.tsx'
import { showToast } from './utils.ts'

/** API base. */
const API_BASE = '/api/dsh-better-sidebar-starter'

/** One persisted log file (from the host list). */
interface LogFileInfo {
  file: string
  name: string
  mtime: number
  size: number
}

/** Render one history log line (stderr red, meta dim). */
function renderLine(line: LogLine, onLinkClick: (link: Parameters<typeof handleLogCodeClick>[4]) => void): ReactNode {
  return createElement('div', { key: `line-${line.key}`, className: 'sts-log-line' },
    ...line.entries.map((entry, i) => {
      const segKey = `line-${line.key}-e${i}`
      const cls = entry.stream === 'stderr'
        ? 'sts-log-stderr'
        : entry.stream === 'meta'
          ? 'sts-log-meta'
          : ''
      return createElement('span', { key: segKey, className: cls },
        renderAnsiLine(entry.text, segKey, onLinkClick))
    }),
  )
}

/** Props. */
export interface LogHistoryViewProps {
  ctx: Context
  sessionId: string
  /** Session working directory (for host cwd resolution + openFile scope). */
  cwd?: string
  /** Close the whole history browser (back to the services view). */
  onClose: () => void
  /** Optional run config name: when set, only that config's log files are
   *  shown (used when clicking a config in the tree). */
  filter?: string
}

/** Split a raw log entry into RenderLine-ready single-line entries. */
function splitEntry(entry: LogEntry, keyBase: number, out: LogLine[]): void {
  const parts = entry.text.split('\n')
  let current: LogEntry[] = []
  const pushLine = (): void => {
    if (current.length > 0) {
      out.push({ entries: current, key: keyBase++ })
      current = []
    }
  }
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) pushLine()
    if (parts[i] !== '') current.push({ stream: entry.stream, text: parts[i], ts: entry.ts })
  }
  if (parts.length > 1 && parts[parts.length - 1] === '') pushLine()
}

/** The log history viewer. */
export function LogHistoryView({ ctx, sessionId, cwd, onClose, filter }: LogHistoryViewProps): ReactNode {
  const [files, setFiles] = useState<LogFileInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeFile, setActiveFile] = useState<LogFileInfo | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [loadedName, setLoadedName] = useState('')
  const lineKeyCounter = useRef(0)

  const loadList = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ sessionId })
      if (cwd !== undefined && cwd !== '') params.set('cwd', cwd)
      const resp = await fetch(`${API_BASE}/logs-history?${params.toString()}`)
      if (!resp.ok) {
        let reason = filter !== undefined ? '加载历史日志失败' : '加载历史日志失败'
        try {
          const err = await resp.json() as { error?: string }
          if (typeof err.error === 'string' && err.error !== '') reason = err.error
        } catch { /* keep generic */ }
        showToast(reason, false)
        setFiles([])
        return
      }
      const data = await resp.json() as { logs?: LogFileInfo[] }
      const all = data.logs ?? []
      // File names are `<safeName>_<stamp>.log`; configs never contain the
      // stamp, so a prefix match on the name string is unambiguous.
      const shown = filter !== undefined ? all.filter((f) => f.name.startsWith(filter)) : all
      setFiles(shown)
    } catch {
      showToast('加载历史日志失败', false)
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [sessionId, cwd, filter])

  // Initial load of the file list.
  const [initialized, setInitialized] = useState(false)
  if (!initialized) {
    setInitialized(true)
    void loadList()
  }

  /** Open one log file and render its content. */
  const openFile = useCallback(async (info: LogFileInfo): Promise<void> => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ sessionId, file: info.file })
      if (cwd !== undefined && cwd !== '') params.set('cwd', cwd)
      const resp = await fetch(`${API_BASE}/logs-history?${params.toString()}`)
      if (!resp.ok) {
        let reason = '读取日志失败'
        try {
          const err = await resp.json() as { error?: string }
          if (typeof err.error === 'string' && err.error !== '') reason = err.error
        } catch { /* keep generic */ }
        showToast(reason, false)
        return
      }
      const data = await resp.json() as { logs?: LogEntry[]; file?: string }
      const out: LogLine[] = []
      for (const entry of data.logs ?? []) {
        splitEntry(entry, lineKeyCounter.current, out)
        lineKeyCounter.current += 200000
      }
      setActiveFile(info)
      setLoadedName(info.name)
      setLines(out)
    } catch {
      showToast('读取日志失败', false)
    } finally {
      setLoading(false)
    }
  }, [sessionId, cwd])

  // ---- list view ----
  if (activeFile === null) {
    const title = filter !== undefined ? `${filter} · 历史日志` : '历史日志'
    return createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
      createElement('div', { className: 'sts-log-toolbar' },
        title,
        createElement('div', { className: 'sts-log-toolbar-spacer' }),
        createElement('button', {
          className: 'sts-icon-btn',
          title: '刷新',
          onClick: () => { void loadList() },
        }, RefreshIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, '刷新')),
        createElement('button', {
          className: 'sts-icon-btn',
          title: filter !== undefined ? '返回服务视图' : '关闭历史日志',
          onClick: onClose,
        }, CloseIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, filter !== undefined ? '返回' : '关闭')),
      ),
      createElement('div', {
        style: { overflow: 'auto', flex: 1, minHeight: 0, padding: '4px 0' },
      },
        loading && files === null
          ? createElement('div', { className: 'sts-empty' }, '加载中…')
          : files !== null && files.length === 0
            ? createElement('div', { className: 'sts-empty' },
                filter !== undefined
                  ? `「${filter}」暂无历史日志。每次启动都会在 <工作空间>/logs/ 下永久保留一份日志，即使启动失败或 dsh 重启也能查看。`
                  : '暂无历史日志（工作空间 logs/ 为空）。每次启动服务都会在 <工作空间>/logs/ 下永久保留一份日志，即使启动失败或 dsh 重启也能查看。')
            : createElement('div', {},
                (files ?? []).map((f) =>
                  createElement('button', {
                    key: f.file,
                    className: 'sts-history-item',
                    title: f.file,
                    onClick: () => { void openFile(f) },
                  },
                    createElement(FileIcon, { size: 13 }),
                    createElement('span', { style: { flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.name),
                    createElement('span', { className: 'sts-history-item-meta' },
                      `${new Date(f.mtime).toLocaleString()}  ${(f.size / 1024).toFixed(1)} KB`),
                  ),
                ),
              ),
      ),
    )
  }

  // ---- file view ----
  return createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    createElement('div', { className: 'sts-log-toolbar' },
      createElement('button', {
        className: 'sts-icon-btn',
        title: '返回文件列表',
        onClick: () => { setActiveFile(null); setLines([]) },
      }, BackIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, '返回')),
      loadedName,
      createElement('span', { style: { opacity: 0.5, marginLeft: '4px' } }, '（历史日志）'),
      createElement('div', { className: 'sts-log-toolbar-spacer' }),
      createElement('button', {
        className: 'sts-icon-btn',
        title: '清空视图',
        onClick: () => setLines([]),
      }, TrashIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, '清空')),
      createElement('button', {
        className: 'sts-icon-btn',
        title: '关闭历史日志',
        onClick: onClose,
      }, CloseIcon({ size: 14 }), createElement('span', { className: 'sts-icon-btn-label' }, '关闭')),
    ),
    createElement('div', { className: 'sts-log-content' },
      loading && lines.length === 0
        ? createElement('div', { className: 'sts-empty' }, '读取中…')
        : lines.length === 0
          ? createElement('div', { className: 'sts-empty' }, '日志文件为空。')
          : lines.map((line) => renderLine(line, (link) => { void handleLogCodeClick(ctx, sessionId, cwd, cwd, link) })),
      lines.length === 0
        ? null
        : createElement('div', { key: 'history-end', style: { opacity: 0.5, marginTop: '6px' } },
            `—— 历史日志已加载完毕（${lines.length} 行），此为只读视图 ——`),
    ),
  )
}