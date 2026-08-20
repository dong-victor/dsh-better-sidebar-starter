/**
 * Config editor modal dialog: create or edit a run configuration.
 * Lets the user set name, type, command, cwd, and environment variables.
 * @module dsh-better-sidebar-starter/client/ConfigEditorModal
 */

import { createElement, useState, useEffect, type ReactNode } from 'react'
import { CloseIcon, PlusIcon, TrashIcon } from './icons.tsx'

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
  } | null
  /** Called when the user saves. */
  onSave: (config: {
    id?: string
    name: string
    type: string
    command: string
    cwd: string
    env: Record<string, string>
  }) => void
  /** Called when the user cancels. */
  onCancel: () => void
}

/** Type → default command mapping. */
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
export function ConfigEditorModal({ config, onSave, onCancel }: ConfigEditorModalProps): ReactNode {
  const [name, setName] = useState(config?.name ?? '')
  const [type, setType] = useState(config?.type ?? 'custom')
  const [command, setCommand] = useState(config?.command ?? '')
  const [cwd, setCwd] = useState(config?.cwd ?? '.')
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    config
      ? Object.entries(config.env).map(([key, value]) => ({ key, value }))
      : [],
  )

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
    onSave({
      id: config?.id,
      name: name.trim(),
      type,
      command: command.trim(),
      cwd: cwd.trim() === '' ? '.' : cwd.trim(),
      env,
    })
  }

  const updateEnvRow = (idx: number, field: 'key' | 'value', val: string): void => {
    setEnvRows((prev) => prev.map((row, i) => i === idx ? { ...row, [field]: val } : row))
  }
  const addEnvRow = (): void => setEnvRows((prev) => [...prev, { key: '', value: '' }])
  const removeEnvRow = (idx: number): void => setEnvRows((prev) => prev.filter((_, i) => i !== idx))

  return createElement('div', {
    className: 'sts-modal-overlay',
    onClick: (e: MouseEvent) => { if (e.target === e.currentTarget) onCancel() },
  },
    createElement('div', { className: 'sts-modal' },
      // Header
      createElement('div', { className: 'sts-modal-header' },
        config?.id ? '编辑运行配置' : '新建运行配置',
        createElement('button', {
          className: 'sts-icon-btn',
          onClick: onCancel,
        }, createElement(CloseIcon, { size: 16 })),
      ),
      // Body
      createElement('div', { className: 'sts-modal-body' },
        // Name
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '名称'),
          createElement('input', {
            className: 'sts-modal-input',
            type: 'text',
            value: name,
            onChange: (e: Event) => setName((e.target as HTMLInputElement).value),
            placeholder: '前端开发服务器',
            autoFocus: true,
          }),
        ),
        // Type
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '类型'),
          createElement('select', {
            className: 'sts-modal-select',
            value: type,
            onChange: (e: Event) => setType((e.target as HTMLSelectElement).value),
          },
            Object.entries(TYPE_LABELS).map(([val, label]) =>
              createElement('option', { key: val, value: val }, label),
            ),
          ),
        ),
        // Command
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '命令'),
          createElement('input', {
            className: 'sts-modal-input mono',
            type: 'text',
            value: command,
            onChange: (e: Event) => setCommand((e.target as HTMLInputElement).value),
            placeholder: TYPE_DEFAULTS[type] || '输入要执行的命令',
          }),
        ),
        // Cwd
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '工作目录（相对工作区）'),
          createElement('input', {
            className: 'sts-modal-input mono',
            type: 'text',
            value: cwd,
            onChange: (e: Event) => setCwd((e.target as HTMLInputElement).value),
            placeholder: '.',
          }),
        ),
        // Env vars
        createElement('div', { className: 'sts-modal-field' },
          createElement('label', { className: 'sts-modal-label' }, '环境变量'),
          ...envRows.map((row, idx) =>
            createElement('div', { key: idx, className: 'sts-env-row' },
              createElement('input', {
                className: 'sts-modal-input mono sts-env-key',
                type: 'text',
                value: row.key,
                onChange: (e: Event) => updateEnvRow(idx, 'key', (e.target as HTMLInputElement).value),
                placeholder: 'KEY',
              }),
              createElement('span', { style: { color: 'var(--dsw-text-secondary, rgba(255,255,255,0.4))' } }, '='),
              createElement('input', {
                className: 'sts-modal-input mono sts-env-val',
                type: 'text',
                value: row.value,
                onChange: (e: Event) => updateEnvRow(idx, 'value', (e.target as HTMLInputElement).value),
                placeholder: 'value',
              }),
              createElement('button', {
                className: 'sts-icon-btn',
                onClick: () => removeEnvRow(idx),
              }, createElement(TrashIcon, { size: 14 })),
            ),
          ),
          createElement('button', { className: 'sts-env-add', onClick: addEnvRow },
            createElement(PlusIcon, { size: 12 }), ' 添加环境变量',
          ),
        ),
      ),
      // Footer
      createElement('div', { className: 'sts-modal-footer' },
        createElement('button', { className: 'sts-modal-btn', onClick: onCancel }, '取消'),
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
        }, '保存'),
      ),
    ),
  )
}
