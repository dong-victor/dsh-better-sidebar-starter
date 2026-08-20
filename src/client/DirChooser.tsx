/**
 * Shared directory chooser: a filesystem folder tree (backed by the sidebar
 * fs.tree API, which can list any absolute path) plus a browse button that
 * opens a modal popup. Browsing starts at the user's home directory and can
 * navigate up to any drive/root, so runtime tool paths (JDK/Maven/...) that
 * live outside the workspace can be selected.
 * @module dsh-better-sidebar-starter/client/DirChooser
 */

import { createElement, useState, useEffect, useRef, type ReactNode } from 'react'
import type { SessionScope } from 'dsh-better-sidebar/client/service'
import { FolderIcon, ChevronRightIcon, ChevronDownIcon, CloseIcon, CheckIcon } from './icons.tsx'

/** One directory entry from the sidebar fs.tree API. */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  isSymlink: boolean
  broken: boolean
}

/** Call the sidebar fs.tree API directly via fetch. Returns directories only. */
export async function fsTree(scope: SessionScope, path: string): Promise<FsEntry[]> {
  const payload: Record<string, string> = { sessionId: scope.sessionId, path }
  if (scope.cwd !== undefined && scope.cwd !== '') payload.cwd = scope.cwd
  const resp = await fetch('/sidebar/api/fs.tree', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error(`fs.tree ${path}: ${resp.status}`)
  const parsed = await resp.json() as { ok?: boolean; value?: { entries: FsEntry[] }; error?: { message: string } }
  if (!parsed.ok || parsed.value === undefined) {
    throw new Error(`fs.tree ${path}: ${parsed.error?.message ?? 'unknown error'}`)
  }
  return parsed.value.entries.filter((e) => e.isDir && !e.hidden)
}

/** Fetch the user's home directory from the host. Falls back to cwd. */
async function fetchHomeDefault(scope: SessionScope): Promise<string> {
  try {
    const r = await fetch('/api/dsh-better-sidebar-starter/detect-env', { method: 'GET' })
    if (r.ok) {
      const data = await r.json() as { home?: string }
      if (data.home && data.home !== '') return data.home
    }
  } catch { /* ignore */ }
  return scope.cwd ?? '.'
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
  const [cur, setCur] = useState<string>('.') // current directory being browsed
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
      fetchHomeDefault(s).then((home) => {
        if (cancelled) return
        setCur(home)
        loadDir(s, home)
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
      createElement('span', { className: 'sts-dirtree-cur', title: cur }, cur || '(.)'),
    ),
    // Current directory selection row + subdir tree
    createElement('div', {
      className: `sts-tree-row${isSelected(cur) ? ' selected' : ''}`,
      style: { paddingLeft: '8px' },
      onClick: () => onPick(cur),
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
        : entries !== null && entries.length > 0
          ? createElement('div', { className: 'sts-dirtree-sub' },
              ...entries.map((entry) => createElement(DirRow, {
                key: entry.path,
                scope,
                entry,
                depth: 1,
                selectedPath,
                expanded,
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
  onToggleExpand: (p: string) => void
  onPick: (p: string) => void
  onNavigate: (p: string) => void
}): ReactNode {
  const { scope, entry, depth, selectedPath, expanded, onToggleExpand, onPick, onNavigate } = props
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
        : children !== null && children.length > 0
          ? createElement('div', null,
              ...children.map((child) =>
                createElement(DirRow, {
                  key: child.path,
                  scope,
                  entry: child,
                  depth: depth + 1,
                  selectedPath,
                  expanded,
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

  return createElement('div', {
    className: 'sts-modal-overlay',
    onClick: (e: MouseEvent) => { if (e.target === e.currentTarget) onCancel() },
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
          onClick: () => onConfirm(sel),
          style: {
            background: '#1a1a1e',
            border: '1px solid #3a3a3e',
            color: '#fff',
            borderRadius: '6px',
            padding: '8px 18px',
            cursor: 'pointer',
            fontSize: '13px',
          },
        },
          createElement(CheckIcon, { size: 14 }), ' \u786e\u5b9a'),
      ),
    ),
  )
}
