/**
 * Config detail card: shown in the right pane when an idle config is selected.
 * Displays the config's full info and offers start / edit / delete buttons.
 * @module dsh-better-sidebar-starter/client/ConfigDetail
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { RunConfig } from './types.ts'
import { PlayIcon, GearIcon, TrashIcon, typeIcon } from './icons.tsx'

/** Props for the detail card. */
export interface ConfigDetailProps {
  config: RunConfig
  onStart: () => void
  onEdit: () => void
  onDelete: () => void
}

const TYPE_LABELS: Record<string, string> = {
  npm: 'npm',
  springboot: 'Spring Boot',
  python: 'Python',
  custom: 'Custom',
}

/** The detail card component. */
export function ConfigDetail({ config, onStart, onEdit, onDelete }: ConfigDetailProps): ReactNode {
  const envEntries = Object.entries(config.env)
  const dateFmt = (ts: number | null): string => {
    if (ts === null) return '—'
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  }

  return createElement('div', { className: 'sts-detail' },
    createElement('div', { className: 'sts-detail-card' },
      // Title
      createElement('div', { className: 'sts-detail-title' },
        typeIcon(config.type, 20),
        config.name,
      ),
      // Type
      createElement('div', { className: 'sts-detail-row' },
        createElement('div', { className: 'sts-detail-label' }, '类型'),
        createElement('div', { className: 'sts-detail-value' }, TYPE_LABELS[config.type] ?? config.type),
      ),
      // Command
      createElement('div', { className: 'sts-detail-row' },
        createElement('div', { className: 'sts-detail-label' }, '命令'),
        createElement('div', { className: 'sts-detail-value' }, config.command),
      ),
      // Cwd
      createElement('div', { className: 'sts-detail-row' },
        createElement('div', { className: 'sts-detail-label' }, '工作目录'),
        createElement('div', { className: 'sts-detail-value' }, config.cwd),
      ),
      // JVM args (springboot only)
      config.type === 'springboot' && config.jvmArgs
        ? createElement('div', { className: 'sts-detail-row' },
            createElement('div', { className: 'sts-detail-label' }, 'JVM参数'),
            createElement('div', { className: 'sts-detail-value' }, config.jvmArgs),
          )
        : null,
      // Program args
      config.args
        ? createElement('div', { className: 'sts-detail-row' },
            createElement('div', { className: 'sts-detail-label' }, '程序实参'),
            createElement('div', { className: 'sts-detail-value' }, config.args),
          )
        : null,
      // Env
      envEntries.length > 0
        ? createElement('div', { className: 'sts-detail-row' },
            createElement('div', { className: 'sts-detail-label' }, '环境变量'),
            createElement('div', { style: { flex: 1 } },
              ...envEntries.map(([key, value]) =>
                createElement('div', { key, className: 'sts-detail-value' },
                  `${key} = ${value}`,
                ),
              ),
            ),
          )
        : null,
      // Timestamps
      createElement('div', { className: 'sts-detail-row' },
        createElement('div', { className: 'sts-detail-label' }, '创建时间'),
        createElement('div', { className: 'sts-detail-value' }, dateFmt(config.createdAt)),
      ),
      config.lastRunAt !== null
        ? createElement('div', { className: 'sts-detail-row' },
            createElement('div', { className: 'sts-detail-label' }, '最近运行'),
            createElement('div', { className: 'sts-detail-value' }, dateFmt(config.lastRunAt)),
          )
        : null,
      // Actions
      createElement('div', { className: 'sts-detail-actions' },
        createElement('button', { className: 'sts-detail-btn danger', onClick: onDelete },
          createElement(TrashIcon, { size: 14 }), ' 删除',
        ),
        createElement('button', { className: 'sts-detail-btn', onClick: onEdit },
          createElement(GearIcon, { size: 14 }), ' 编辑',
        ),
        createElement('button', {
          className: 'sts-detail-btn primary',
          onClick: onStart,
          style: {
            background: '#1a1a1e',
            border: '1px solid #3a3a3e',
            color: '#fff',
            borderRadius: '6px',
            padding: '6px 14px',
            cursor: 'pointer',
            fontSize: '12px',
          },
        },
          createElement(PlayIcon, { size: 14 }), ' 启动',
        ),
      ),
    ),
  )
}
