/**
 * Config editor modal dialog: create or edit a run configuration.
 * Lets the user set name, type, command, cwd (tree picker), jvmArgs, args,
 * and environment variables.
 * @module dsh-better-sidebar-starter/client/ConfigEditorModal
 */

import { createElement, useState, useEffect, type ReactNode } from 'react'
import type { SessionScope } from 'dsh-better-sidebar/client/service'
import { CloseIcon, PlusIcon, TrashIcon, ChevronRightIcon, FolderIcon, ClipboardIcon } from './icons.tsx'
import { PathPicker } from './PathPicker.tsx'

/** One directory entry from the sidebar fs.tree API. */
interface FsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  isSymlink: boolean
  broken: boolean
}

/** Call the sidebar fs.tree API directly via fetch. Returns directories only.
 *  If path is omitted, the server uses the session cwd (root listing).
 *  The sidebar API wraps responses in { ok: true, value: ... } envelope. */
async function fsTree(scope: SessionScope, path?: string): Promise<FsEntry[]> {
  const payload: Record<string, string> = { sessionId: scope.sessionId }
  if (scope.cwd !== undefined && scope.cwd !== '') payload.cwd = scope.cwd
  if (path !== undefined) payload.path = path
  const resp = await fetch('/sidebar/api/fs.tree', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error(`fs.tree ${path ?? '(root)'}: ${resp.status}`)
  const parsed = await resp.json() as { ok?: boolean; value?: { entries: FsEntry[] }; error?: { message: string } }
  if (!parsed.ok || parsed.value === undefined) {
    throw new Error(`fs.tree ${path ?? '(root)'}: ${parsed.error?.message ?? 'unknown error'}`)
  }
  return parsed.value.entries.filter((e) => e.isDir && !e.hidden)
}

/** Recursive tree node: loads its own children on expand. */
function TreeNode(props: {
  scope: SessionScope
  entry: FsEntry
  depth: number
  selectedPath: string
  onSelect: (path: string) => void
}): ReactNode {
  const { scope, entry, depth, selectedPath, onSelect } = props
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const handleToggle = (): void => {
    if (!expanded && children === null) {
      setLoading(true)
      fsTree(scope, entry.path)
        .then((dirs) => { setChildren(dirs); setLoading(false) })
        .catch(() => { setChildren([]); setLoading(false) })
    }
    setExpanded(!expanded)
  }

  const isSelected = selectedPath === entry.path

  return createElement('div', null,
    createElement('div', {
      className: `sts-tree-row${isSelected ? ' selected' : ''}`,
      style: { paddingLeft: `${depth * 16 + 8}px` },
      onClick: () => { onSelect(entry.path); handleToggle() },
    },
      createElement('span', { className: `sts-tree-chevron${expanded ? ' expanded' : ''}` },
        createElement(ChevronRightIcon, { size: 12 }),
      ),
      createElement('span', { className: 'sts-tree-icon' },
        createElement(FolderIcon, { size: 14 }),
      ),
      createElement('span', { className: 'sts-tree-label' }, entry.name),
    ),
    expanded
      ? loading
        ? createElement('div', { className: 'sts-tree-loading', style: { paddingLeft: `${(depth + 1) * 16 + 8}px` } }, '\u52a0\u8f7d\u4e2d...')
        : children !== null && children.length > 0
          ? createElement('div', null,
              ...children.map((child) =>
                createElement(TreeNode, {
                  key: child.path,
                  scope,
                  entry: child,
                  depth: depth + 1,
                  selectedPath,
                  onSelect,
                }),
              ),
            )
          : createElement('div', { className: 'sts-tree-empty', style: { paddingLeft: `${(depth + 1) * 16 + 8}px` } }, '\u65e0\u5b50\u76ee\u5f55')
      : null,
  )
}

/** Directory tree picker: shows a collapsible tree rooted at session cwd. */
function DirTreePicker(props: { scope: SessionScope; value: string; onSelect: (path: string) => void }): ReactNode {
  const { scope, value, onSelect } = props
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleToggle = (): void => {
    if (!expanded && children === null) {
      setLoading(true)
      setError(null)
      fsTree(scope)
        .then((dirs) => { setChildren(dirs); setLoading(false) })
        .catch((err) => { setError(err instanceof Error ? err.message : String(err)); setLoading(false) })
    }
    setExpanded(!expanded)
  }

  const rootSelected = value === '.' || value === '' || value === './'

  return createElement('div', { className: 'sts-tree-picker' },
    createElement('div', {
      className: `sts-tree-row${rootSelected ? ' selected' : ''}`,
      style: { paddingLeft: '8px' },
      onClick: () => { onSelect('.'); handleToggle() },
    },
      createElement('span', { className: `sts-tree-chevron${expanded ? ' expanded' : ''}` },
        createElement(ChevronRightIcon, { size: 12 }),
      ),
      createElement('span', { className: 'sts-tree-icon' },
        createElement(FolderIcon, { size: 14 }),
      ),
      createElement('span', { className: 'sts-tree-label' }, '(\u5de5\u4f5c\u7a7a\u95f4\u6839\u76ee\u5f55)'),
    ),
    expanded
      ? loading
        ? createElement('div', { className: 'sts-tree-loading', style: { paddingLeft: '24px' } }, '\u52a0\u8f7d\u4e2d...')
        : error !== null
          ? createElement('div', { className: 'sts-tree-error', style: { paddingLeft: '24px' } }, error)
          : children !== null && children.length > 0
            ? createElement('div', null,
                ...children.map((child) =>
                  createElement(TreeNode, {
                    key: child.path,
                    scope,
                    entry: child,
                    depth: 1,
                    selectedPath: value,
                    onSelect,
                  }),
                ),
              )
            : createElement('div', { className: 'sts-tree-empty', style: { paddingLeft: '24px' } }, '\u65e0\u5b50\u76ee\u5f55')
      : null,
  )
}

/** One env var row. */
interface EnvRow {
  key: string
  value: string
}

/** Props for the modal. */
export interface ConfigEditorModalProps {
  /** Existing config to edit, or null for a new config. */
  config: {
    id?: string
    name: string
    type: string
    command: string
    cwd: string
    env: Record<string, string>
    jvmArgs?: string
    args?: string
    runtime?: { java?: string; node?: string; python?: string; mvn?: string }
  } | null
  /** Session scope for fsTree calls. */
  scope: SessionScope
  /** Called when the user saves. */
  onSave: (config: {
    id?: string
    name: string
    type: string
    command: string
    cwd: string
    env: Record<string, string>
    jvmArgs: string
    args: string
    runtime: Record<string, string>
  }) => void
  /** Called when the user cancels. */
  onCancel: () => void
}

/** Type \u2192 default command mapping. */
const TYPE_DEFAULTS: Record<string, string> = {
  npm: 'npm run dev',
  springboot: 'mvn spring-boot:run',
  python: 'python main.py',
  custom: '',
}

const TYPE_LABELS: Record<string, string> = {
  npm: 'npm',
  springboot: 'Spring Boot',
  python: 'Python',
  custom: 'Custom',
}

/** The modal dialog component. */
export function ConfigEditorModal({ config, scope, onSave, onCancel }: ConfigEditorModalProps): ReactNode {
  const [name, setName] = useState(config?.name ?? '')
  const [type, setType] = useState(config?.type ?? 'custom')
  const [command, setCommand] = useState(config?.command ?? '')
  const [cwd, setCwd] = useState(config?.cwd ?? '.')
  const [jvmArgs, setJvmArgs] = useState(config?.jvmArgs ?? '')
  const [args, setArgs] = useState(config?.args ?? '')
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    config
      ? Object.entries(config.env).map(([key, value]) => ({ key, value }))
      : [],
  )
  const [showTree, setShowTree] = useState(false)
  const [showRuntime, setShowRuntime] = useState(false)
  const [rtJava, setRtJava] = useState(config?.runtime?.java ?? '')
  const [rtNode, setRtNode] = useState(config?.runtime?.node ?? '')
  const [rtPython, setRtPython] = useState(config?.runtime?.python ?? '')
  const [rtMvn, setRtMvn] = useState(config?.runtime?.mvn ?? '')

  // When type changes and command is empty (new config), auto-fill template.
  useEffect(() => {
    if (command === '' && TYPE_DEFAULTS[type] !== '') {
      setCommand(TYPE_DEFAULTS[type])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const handleSave = (): void => {
    const env: Record<string, string> = {}
    for (const row of envRows) {
      if (row.key.trim() !== '') {
        env[row.key.trim()] = row.value
      }
    }
    const runtime: Record<string, string> = {}
    if (rtJava.trim() !== '') runtime.java = rtJava.trim()
    if (rtNode.trim() !== '') runtime.node = rtNode.trim()
    if (rtPython.trim() !== '') runtime.python = rtPython.trim()
    if (rtMvn.trim() !== '') runtime.mvn = rtMvn.trim()
    onSave({
      id: config?.id,
      name: name.trim(),
      type,
      command: command.trim(),
      cwd: cwd.trim() === '' ? '.' : cwd.trim(),
      env,
      jvmArgs: jvmArgs.trim(),
      args: args.trim(),
      runtime,
    })
  }

  const updateEnvRow = (idx: number, field: 'key' | 'value', val: string): void => {
    setEnvRows((prev) => prev.map((row, i) => i === idx ? { ...row, [field]: val } : row))
  }
  const addEnvRow = (): void => setEnvRows((prev) => [...prev, { key: '', value: '' }])
  const removeEnvRow = (idx: number): void => setEnvRows((prev) => prev.filter((_, i) => i !== idx))

  // Bulk paste state.
  const [showEnvPaste, setShowEnvPaste] = useState(false)
  const [envPasteText, setEnvPasteText] = useState('')

  /** Parse "K=V;K=V,..." (or newline/comma separated) into env rows, merging
   *  into the existing rows (later values override earlier for duplicate keys). */
  const applyEnvPaste = (): void => {
    const existing = new Map(envRows.filter((r) => r.key.trim() !== '').map((r) => [r.key.trim(), r.value]))
    const text = envPasteText.trim()
    if (text === '') return
    // Split on semicolons, commas, or newlines.
    const pairs = text.split(/[;,\n]+/)
    for (const pair of pairs) {
      const p = pair.trim()
      if (p === '') continue
      const eq = p.indexOf('=')
      if (eq <= 0) continue // ignore malformed entries
      const key = p.substring(0, eq).trim()
      const value = p.substring(eq + 1).trim()
      if (key !== '') existing.set(key, value)
    }
    setEnvRows(Array.from(existing, ([key, value]) => ({ key, value })))
    setEnvPasteText('')
    setShowEnvPaste(false)
  }

  const isSpringboot = type === 'springboot'

  return createElement('div', {
    className: 'sts-modal-overlay',
    onClick: (e: MouseEvent) => { if (e.target === e.currentTarget) onCancel() },
  },
    createElement('div', { className: 'sts-modal' },
      // Header
      createElement('div', { className: 'sts-modal-header' },
        config?.id ? '\u7f16\u8f91\u8fd0\u884c\u914d\u7f6e' : '\u65b0\u5efa\u8fd0\u884c\u914d\u7f6e',
        createElement('button', {
          className: 'sts-icon-btn',
          onClick: onCancel,
        }, createElement(CloseIcon, { size: 16 })),
      ),
      // Body
      createElement('div', { className: 'sts-modal-body' },
        // Name
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '\u540d\u79f0'),
          createElement('input', {
            className: 'sts-modal-input',
            value: name,
            onChange: (e: { target: { value: string } }) => setName(e.target.value),
            placeholder: '\u914d\u7f6e\u540d\u79f0',
          }),
        ),
        // Type
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '\u7c7b\u578b'),
          createElement('select', {
            className: 'sts-modal-select',
            value: type,
            onChange: (e: { target: { value: string } }) => setType(e.target.value),
          },
            ...Object.entries(TYPE_LABELS).map(([val, label]) =>
              createElement('option', { key: val, value: val }, label),
            ),
          ),
        ),
        // Command
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '\u547d\u4ee4'),
          createElement('input', {
            className: 'sts-modal-input mono',
            value: command,
            onChange: (e: { target: { value: string } }) => setCommand(e.target.value),
            placeholder: '\u8981\u6267\u884c\u7684\u547d\u4ee4',
          }),
        ),
        // Working directory (tree picker)
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '\u5de5\u4f5c\u76ee\u5f55'),
          createElement('div', { className: 'sts-cwd-display', onClick: () => setShowTree(!showTree) },
            createElement('span', { className: 'sts-cwd-icon' }, createElement(FolderIcon, { size: 14 })),
            createElement('span', { className: 'sts-cwd-value' }, cwd),
          ),
          showTree
            ? createElement('div', { className: 'sts-tree-picker-container' },
                createElement(DirTreePicker, { scope, value: cwd, onSelect: (p) => setCwd(p) }),
              )
            : null,
        ),
        // JVM args (springboot only)
        isSpringboot
          ? createElement('div', { className: 'sts-modal-field' },
              createElement('label', { className: 'sts-modal-label' }, '\u865a\u62df\u673a\u53c2\u6570 (JVM Args)'),
              createElement('input', {
                className: 'sts-modal-input mono',
                value: jvmArgs,
                onChange: (e: { target: { value: string } }) => setJvmArgs(e.target.value),
                placeholder: '\u4f8b: -Xmx512m -Dspring.profiles.active=dev',
              }),
            )
          : null,
        // Program args (all types)
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '\u7a0b\u5e8f\u5b9e\u53c2'),
          createElement('input', {
            className: 'sts-modal-input mono',
            value: args,
            onChange: (e: { target: { value: string } }) => setArgs(e.target.value),
            placeholder: '\u4f8b: --server.port=8080 --debug',
          }),
        ),
        // Runtime environment (collapsible advanced section)
        createElement('div', { className: 'sts-modal-field' },
          createElement('div', {
            className: `sts-collapse-header${showRuntime ? ' open' : ''}`,
            onClick: () => setShowRuntime(!showRuntime),
          },
            createElement('span', { className: `sts-collapse-chevron${showRuntime ? ' expanded' : ''}` },
              createElement(ChevronRightIcon, { size: 12 }),
            ),
            createElement('span', null, '\u8fd0\u884c\u65f6\u73af\u5883 (\u9ad8\u7ea7)'),
            createElement('span', { className: 'sts-collapse-hint' }, '\u9ed8\u8ba4\u7528\u5168\u5c40\u914d\u7f6e'),
          ),
          showRuntime
            ? createElement('div', { className: 'sts-collapse-body' },
                createElement('div', { className: 'sts-modal-label' }, '\u7559\u7a7a\u5219\u7528\u5168\u5c40/\u7cfb\u7edf\u914d\u7f6e'),
                createElement('div', { className: 'sts-modal-field' },
                  createElement('label', { className: 'sts-modal-label' }, 'Java \u8def\u5f84'),
                  createElement(PathPicker, {
                    scope,
                    kind: 'java',
                    value: rtJava,
                    onChange: setRtJava,
                    compact: true,
                    desc: '\u9009\u62e9 JDK \u76ee\u5f55',
                  }),
                ),
                createElement('div', { className: 'sts-modal-field' },
                  createElement('label', { className: 'sts-modal-label' }, 'Node.js \u8def\u5f84'),
                  createElement(PathPicker, {
                    scope,
                    kind: 'node',
                    value: rtNode,
                    onChange: setRtNode,
                    compact: true,
                    desc: '\u9009\u62e9 Node \u76ee\u5f55',
                  }),
                ),
                createElement('div', { className: 'sts-modal-field' },
                  createElement('label', { className: 'sts-modal-label' }, 'Python \u8def\u5f84'),
                  createElement(PathPicker, {
                    scope,
                    kind: 'python',
                    value: rtPython,
                    onChange: setRtPython,
                    compact: true,
                    desc: '\u9009\u62e9 Python \u76ee\u5f55',
                  }),
                ),
                createElement('div', { className: 'sts-modal-field' },
                  createElement('label', { className: 'sts-modal-label' }, 'Maven \u8def\u5f84 (MVN)'),
                  createElement(PathPicker, {
                    scope,
                    kind: 'mvn',
                    value: rtMvn,
                    onChange: setRtMvn,
                    compact: true,
                    desc: '\u9009\u62e9 Maven \u76ee\u5f55',
                  }),
                ),
              )
            : null,
        ),
        // Environment variables
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '\u73af\u5883\u53d8\u91cf'),
          ...envRows.map((row, idx) =>
            createElement('div', { key: idx, className: 'sts-env-row' },
              createElement('input', {
                className: 'sts-modal-input sts-env-key',
                value: row.key,
                onChange: (e: { target: { value: string } }) => updateEnvRow(idx, 'key', e.target.value),
                placeholder: '\u53d8\u91cf\u540d (\u5982 JAVA_HOME)',
              }),
              createElement('span', { className: 'sts-env-sep' }, '='),
              createElement('input', {
                className: 'sts-modal-input sts-env-val',
                value: row.value,
                onChange: (e: { target: { value: string } }) => updateEnvRow(idx, 'value', e.target.value),
                placeholder: '\u53d8\u91cf\u503c',
              }),
              createElement('button', {
                className: 'sts-icon-btn trash',
                onClick: () => removeEnvRow(idx),
              }, createElement(TrashIcon, { size: 14 })),
            ),
          ),
          createElement('div', { className: 'sts-env-actions' },
            createElement('button', {
              className: 'sts-env-add', onClick: addEnvRow,
            },
              createElement(PlusIcon, { size: 12 }), ' \u6dfb\u52a0\u73af\u5883\u53d8\u91cf',
            ),
            createElement('button', {
              className: 'sts-env-add', onClick: () => setShowEnvPaste(!showEnvPaste),
            },
              createElement(ClipboardIcon, { size: 12 }), showEnvPaste ? ' \u53d6\u6d88' : ' \u6279\u91cf\u7c98\u8d34',
            ),
          ),
          showEnvPaste
            ? createElement('div', { className: 'sts-env-paste' },
                createElement('textarea', {
                  className: 'sts-env-paste-input',
                  value: envPasteText,
                  onChange: (e: { target: { value: string } }) => setEnvPasteText(e.target.value),
                  placeholder: '\u7c98\u8d34 KEY=VALUE;KEY=VALUE;\u6216\u4ee5\u6362\u884c/\u9017\u53f7\u5206\u9694\uff0c\u5982\uff1a\nDB_DATABASE=cassiopeia_ap;DB_HOST=10.18.18.18;DB_PORT=3306;MQ_HOST=10.18.18.18;MQ_PASSWORD=admin123;MQ_PORT=5672;MQ_USERNAME=admin;MQ_VIRTUAL_HOST=/;REDIS_HOST=10.18.18.17;REDIS_PASSWORD=Qaz!wsx2;REDIS_PORT=6379',
                  rows: 4,
                }),
                createElement('div', { className: 'sts-env-paste-footer' },
                  createElement('button', {
                    className: 'sts-env-paste-apply', onClick: applyEnvPaste,
                  },
                    '\u786e\u5b9a\u5e76\u751f\u6210\u73af\u5883\u53d8\u91cf'),
                  createElement('span', { className: 'sts-env-paste-hint' }, '\u91cd\u590d\u5c06\u8986\u76d6'),
                ),
              )
            : null,
        ),
      ),
      // Footer
      createElement('div', { className: 'sts-modal-footer' },
        createElement('button', { className: 'sts-modal-btn', onClick: onCancel }, '\u53d6\u6d88'),
        createElement('button', {
          className: 'sts-modal-btn primary',
          onClick: handleSave,
          disabled: name.trim() === '',
          style: {
            background: '#1a1a1e',
            border: '1px solid #3a3a3e',
            color: '#fff',
            borderRadius: '6px',
            padding: '8px 18px',
            cursor: name.trim() === '' ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            opacity: name.trim() === '' ? 0.5 : 1,
          },
        }, '\u4fdd\u5b58'),
      ),
    ),
  )
}
