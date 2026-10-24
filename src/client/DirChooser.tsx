/**
 * Shared directory chooser: a filesystem folder tree (backed by the starter
 * plugin's own fs-dirs host route) plus a browse button that opens a modal
 * popup. Browsing starts at the user's home directory and can navigate up to
 * any drive/root, so runtime tool paths (JDK/Maven/...) that live outside the
 * workspace can be selected. The sidebar fs.tree API cannot be used here — it
 * is workspace-confined since dsh-better-sidebar 0.16 (403 outside the
 * session workspace).
 * @module dsh-better-sidebar-starter/client/DirChooser
 */

import { createElement, useState, useEffect, useRef, type ReactNode } from 'react'
import type { SessionScope } from 'dsh-better-sidebar/client/service'
import { FolderIcon, ChevronRightIcon, ChevronDownIcon, CloseIcon, CheckIcon, EyeIcon, EyeOffIcon } from './icons.tsx'
import { useBackdropDismiss } from './useBackdropDismiss.ts'

/** One directory entry from the starter fs-dirs host route. */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  isSymlink: boolean
  broken: boolean
}

/** Call the starter fs-dirs host route via fetch. Returns directories only,
 *  INCLUDING hidden ones (flagged via `hidden`) — visibility is decided at
 *  render time so the show-hidden toggle works without refetching. */
export async function fsTree(scope: SessionScope, path: string): Promise<FsEntry[]> {
  // The host route only accepts absolute paths; sending a relative one (the
  // old `'.'` fallback) turned an unresolved root into an opaque 404, so
  // refuse it here with a message that names the real problem.
  if (!isAbsolutePath(path)) {
    throw new Error(`fs-dirs: 需要绝对路径，收到 "${path}"（可先点刷新回到主目录）`)
  }
  const resp = await fetch('/api/dsh-better-sidebar-starter/fs-dirs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: scope.sessionId, path }),
  })
  const parsed = await resp.json().catch(() => undefined) as { entries?: FsEntry[]; error?: string } | undefined
  if (!resp.ok) {
    // Our host handler answers every failure with an `error` string. A body
    // without one means something upstream answered instead — the route is not
    // registered (plugin inactive or not loaded), which used to surface as a
    // bare, unactionable `fs-dirs <path>: 404`.
    if (parsed?.error === undefined) {
      throw new Error(
        `fs-dirs: 插件的 host 路由未注册（HTTP ${resp.status}）。` +
        '说明 dsh 加载时该插件未激活或加载失败，请查看 dsh 启动日志中是否出现 ' +
        '"[starter] host routes mounted"，并重启 dsh 后重试。',
      )
    }
    throw new Error(`fs-dirs ${path}: ${parsed.error}`)
  }
  return (parsed?.entries ?? []).filter((e) => e.isDir)
}

/** Render-time hidden-entry filter shared by the tree components. */
export function visibleDirs(entries: FsEntry[], showHidden: boolean): FsEntry[] {
  return showHidden ? entries : entries.filter((e) => !e.hidden)
}

/** Whether a path is absolute on this platform (either separator style). */
export function isAbsolutePath(p: string): boolean {
  if (p === '') return false
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p)
}

/** Resolve the directory to start browsing in: the host's home directory when
 *  it can be read, else an absolute client-side candidate. Never returns a
 *  relative path — the fs-dirs route rejects those, which is what used to
 *  surface as a bare `fs-dirs .: 404`. */
async function fetchHomeDefault(scope: SessionScope): Promise<string> {
  try {
    const r = await fetch('/api/dsh-better-sidebar-starter/detect-env', { method: 'GET' })
    if (r.ok) {
      const data = await r.json() as { home?: string }
      if (data.home && isAbsolutePath(data.home)) return data.home
    }
  } catch { /* ignore */ }
  for (const candidate of [scope.cwd]) {
    if (candidate !== undefined && isAbsolutePath(candidate)) return candidate
  }
  throw new Error('fs-dirs: 无法确定起始目录（主机未返回主目录，且会话工作目录不可用）')
}

/** Normalize a path, returning its parent or null if at the root. */
function parentOf(p: string): string | null {
  const trimmed = p.replace(/[\\/]+$/, '')
  const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (lastSep <= 0) return null
  return trimmed.substring(0, lastSep)
}

/** The folder tree panel: shows the current dir's subdirectories with up-nav. */
export function DirTree(props: {
  scope: SessionScope
  selectedPath: string
  onPick: (path: string) => void
}): ReactNode {
  const { scope, selectedPath, onPick } = props
  const [cur, setCur] = useState<string>('') // current directory being browsed
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false) // reveal dot/hidden dirs

  // Stash scope in a ref so the init effect only runs once regardless of the
  // parent re-rendering with a fresh scope object each frame.
  const scopeRef = useRef(scope)
  const initDoneRef = useRef(false)
  // Remember the initial selected value so the popup opens at, or as close to
  // as possible, the already-configured path.
  const initialValueRef = useRef(selectedPath)

  // Initialize browsing root: prefer an existing selected path, else home.
  useEffect(() => {
    if (initDoneRef.current) return
    initDoneRef.current = true
    let cancelled = false
    const s = scopeRef.current
    const startPath = initialValueRef.current?.trim() && initialValueRef.current !== '.' && initialValueRef.current !== './'
      ? initialValueRef.current.trim()
      : null
    if (startPath !== null) {
      setCur(startPath)
      loadDir(s, startPath)
      // If the start path points at a file dir inside a parent, still fine.
    } else {
      setLoading(true)
      fetchHomeDefault(s).then((home) => {
        if (cancelled) return
        setCur(home)
        loadDir(s, home)
      }).catch((err) => {
        if (cancelled) return
        setLoading(false)
        setError(err instanceof Error ? err.message : String(err))
      })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDir = (s: SessionScope, path: string): void => {
    setLoading(true)
    setError(null)
    fsTree(s, path)
      .then((dirs) => {
        setEntries(dirs)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }

  const goUp = (): void => {
    const parent = parentOf(cur)
    if (parent !== null) {
      setCur(parent)
      loadDir(scopeRef.current, parent)
    }
  }

  const navigateInto = (path: string): void => {
    setCur(path)
    loadDir(scopeRef.current, path)
  }

  const toggleExpand = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const isSelected = (p: string): boolean => selectedPath !== '' && selectedPath !== '.' && selectedPath === p

  return createElement('div', { className: 'sts-dirtree' },
    // Navigation bar: current path + up button
    createElement('div', { className: 'sts-dirtree-nav' },
      createElement('button', {
        className: 'sts-dirtree-up',
        onClick: goUp,
        disabled: parentOf(cur) === null,
        title: '\u4e0a\u7ea7\u76ee\u5f55',
      }, '\u2191'),
      createElement('button', {
        className: 'sts-dirtree-home',
        onClick: () => loadDir(scopeRef.current, cur), // refresh current dir
        title: '\u5237\u65b0',
      }, '\u21bb'),
      createElement('button', {
        className: 'sts-dirtree-home',
        onClick: () => setShowHidden(!showHidden),
        title: showHidden ? '\u9690\u85cf\u9690\u85cf\u76ee\u5f55' : '\u663e\u793a\u9690\u85cf\u76ee\u5f55',
        style: showHidden
          ? { color: '#61afef', opacity: 1 }
          : { opacity: 0.6 },
      }, createElement(showHidden ? EyeIcon : EyeOffIcon, { size: 13 })),
      createElement('span', { className: 'sts-dirtree-cur', title: cur }, cur || '(.)'),
    ),
    // Current directory selection row + subdir tree
    createElement('div', {
      className: `sts-tree-row${isSelected(cur) ? ' selected' : ''}`,
      style: { paddingLeft: '8px' },
      // An unresolved root (still loading, or no absolute path available)
      // must not be selectable — that is how `'.'` used to be confirmed.
      onClick: () => { if (cur !== '') onPick(cur) },
    },
      createElement('span', { className: 'sts-tree-icon' },
        createElement(FolderIcon, { size: 14 }),
      ),
      createElement('span', { className: 'sts-tree-label' }, cur || '(.)'),
      createElement('span', { className: 'sts-tree-select-hint' }, '\u25cf \u9009\u62e9\u6b64\u76ee\u5f55'),
    ),
    loading
      ? createElement('div', { className: 'sts-tree-loading', style: { paddingLeft: '16px' } }, '\u52a0\u8f7d\u4e2d...')
      : error !== null
        ? createElement('div', { className: 'sts-tree-error', style: { paddingLeft: '16px' } }, error)
        : entries !== null && visibleDirs(entries, showHidden).length > 0
          ? createElement('div', { className: 'sts-dirtree-sub' },
              ...visibleDirs(entries, showHidden).map((entry) => createElement(DirRow, {
                key: entry.path,
                scope,
                entry,
                depth: 1,
                selectedPath,
                expanded,
                showHidden,
                onToggleExpand: toggleExpand,
                onPick,
                onNavigate: navigateInto,
              })),
            )
          : createElement('div', { className: 'sts-tree-empty', style: { paddingLeft: '16px' } }, '\u65e0\u5b50\u76ee\u5f55'),
  )
}

/** One directory row with recursive expansion + click into. */
function DirRow(props: {
  scope: SessionScope
  entry: FsEntry
  depth: number
  selectedPath: string
  expanded: Set<string>
  showHidden: boolean
  onToggleExpand: (p: string) => void
  onPick: (p: string) => void
  onNavigate: (p: string) => void
}): ReactNode {
  const { scope, entry, depth, selectedPath, expanded, showHidden, onToggleExpand, onPick, onNavigate } = props
  const [children, setChildren] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const isExpanded = expanded.has(entry.path)
  const isSelected = selectedPath === entry.path

  const handleClick = (): void => {
    // Clicking a row selects it AND expands to reveal children (unless already
    // expanded, in which case a second click collapses).
    onPick(entry.path)
    if (isExpanded) {
      onToggleExpand(entry.path)
      return
    }
    onToggleExpand(entry.path)
    if (children === null) {
      setLoading(true)
      fsTree(scope, entry.path)
        .then((dirs) => { setChildren(dirs); setLoading(false) })
        .catch(() => { setChildren([]); setLoading(false) })
    }
  }

  return createElement('div', null,
    createElement('div', {
      className: `sts-tree-row${isSelected ? ' selected' : ''}`,
      style: { paddingLeft: `${depth * 16 + 8}px` },
      onClick: handleClick,
    },
      createElement('span', { className: `sts-tree-chevron${isExpanded ? ' expanded' : ''}` },
        createElement(isExpanded ? ChevronDownIcon : ChevronRightIcon, { size: 12 }),
      ),
      createElement('span', { className: 'sts-tree-icon' },
        createElement(FolderIcon, { size: 14 }),
      ),
      createElement('span', { className: 'sts-tree-label' }, entry.name),
    ),
    isExpanded
      ? loading
        ? createElement('div', { className: 'sts-tree-loading', style: { paddingLeft: `${(depth + 1) * 16 + 8}px` } }, '\u52a0\u8f7d\u4e2d...')
        : children !== null && visibleDirs(children, showHidden).length > 0
          ? createElement('div', null,
              ...visibleDirs(children, showHidden).map((child) =>
                createElement(DirRow, {
                  key: child.path,
                  scope,
                  entry: child,
                  depth: depth + 1,
                  selectedPath,
                  expanded,
                  showHidden,
                  onToggleExpand: onToggleExpand,
                  onPick,
                  onNavigate: props.onNavigate,
                }),
              ),
            )
          : null
      : null,
  )
}

/** Props for the browse button + modal chooser. */
export interface DirChooserProps {
  scope: SessionScope
  value: string
  onChange: (v: string) => void
  /** Button/input presentation. */
  compact?: boolean
  /** Placeholder for the value input. */
  placeholder?: string
}

/** A read-only path input + browse button that opens a modal folder tree. */
export function DirChooser(props: DirChooserProps): ReactNode {
  const { scope, value, onChange, compact, placeholder } = props
  const [open, setOpen] = useState(false)

  return createElement('div', { className: 'sts-settings-path-row' },
    createElement('span', { className: 'sts-settings-path-icon' },
      createElement(FolderIcon, { size: 14 }),
    ),
    createElement('input', {
      className: compact ? 'sts-modal-input mono' : 'sts-settings-input',
      value: value,
      readOnly: true,
      placeholder: placeholder ?? '',
      title: value,
      onClick: () => setOpen(true),
    }),
    createElement('button', {
      className: 'sts-settings-browse',
      onClick: () => setOpen(true),
      title: '\u9009\u62e9\u6587\u4ef6\u5939',
    }, '\u6d4f\u89c8'),
    open
      ? createElement(DirChooserModal, {
          scope,
          value,
          onConfirm: (p) => { onChange(p); setOpen(false) },
          onCancel: () => setOpen(false),
        })
      : null,
  )
}

/** Modal popup hosting the folder tree with confirm/cancel. */
function DirChooserModal(props: {
  scope: SessionScope
  value: string
  onConfirm: (path: string) => void
  onCancel: () => void
}): ReactNode {
  const { scope, value, onConfirm, onCancel } = props
  const [sel, setSel] = useState(value)
  // Only an absolute directory can be stored: the runtime path pickers feed
  // these values straight to the host (spawn cwd / tool lookup), and an empty
  // or `'.'` value previously propagated a relative path.
  const canConfirm = isAbsolutePath(sel)
  // Same guard as the config editor: a drag-selection must not dismiss.
  const backdrop = useBackdropDismiss(onCancel)

  return createElement('div', {
    className: 'sts-modal-overlay',
    ...backdrop,
  },
    createElement('div', { className: 'sts-dir-modal' },
      createElement('div', { className: 'sts-modal-header' },
        '\u9009\u62e9\u6587\u4ef6\u5939',
        createElement('button', { className: 'sts-icon-btn', onClick: onCancel },
          createElement(CloseIcon, { size: 16 }),
        ),
      ),
      createElement('div', { className: 'sts-dir-modal-tree' },
        createElement(DirTree, { scope, selectedPath: sel, onPick: setSel }),
      ),
      createElement('div', { className: 'sts-modal-footer' },
        createElement('button', { className: 'sts-modal-btn', onClick: onCancel }, '\u53d6\u6d88'),
        createElement('button', {
          className: 'sts-modal-btn primary',
          onClick: () => { if (canConfirm) onConfirm(sel) },
          disabled: !canConfirm,
          title: canConfirm ? '\u786e\u5b9a' : '\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u7edd\u5bf9\u8def\u5f84\u76ee\u5f55',
          style: {
            background: '#1a1a1e',
            border: '1px solid #3a3a3e',
            color: '#fff',
            borderRadius: '6px',
            padding: '8px 18px',
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            opacity: canConfirm ? 1 : 0.5,
            fontSize: '13px',
          },
        },
          createElement(CheckIcon, { size: 14 }), ' \u786e\u5b9a'),
      ),
    ),
  )
}
