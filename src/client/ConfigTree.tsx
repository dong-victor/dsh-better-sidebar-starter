/**
 * Config tree: the left pane showing all run configurations grouped by type,
 * with running instances as child nodes.
 * @module dsh-better-sidebar-starter/client/ConfigTree
 */

import { createElement, useState, useMemo, type ReactNode } from 'react'
import type { RunConfig, RunInstance } from './types.ts'
import {
  PlayIcon, StopIcon, GearIcon,
  ChevronDownIcon, ChevronRightIcon,
  RunningDotIcon, CheckIcon, ErrorDotIcon,
  typeIcon,
} from './icons.tsx'

/** Props for the config tree. */
export interface ConfigTreeProps {
  configs: RunConfig[]
  instances: RunInstance[]
  selectedInstanceId: string | null
  selectedConfigId: string | null
  onSelectConfig: (configId: string) => void
  onSelectInstance: (instanceId: string) => void
  onStartConfig: (configId: string) => void
  onStopInstance: (instanceId: string) => void
  onEditConfig: (configId: string) => void
}

/** Type group order. */
const TYPE_ORDER: string[] = ['npm', 'springboot', 'python', 'custom']
const TYPE_LABELS: Record<string, string> = {
  npm: 'npm', springboot: 'Spring Boot', python: 'Python', custom: 'Custom',
}

/** Status icon for an instance. */
function statusIcon(status: string, size: number): ReactNode {
  switch (status) {
    case 'running': return RunningDotIcon({ size })
    case 'exited': return CheckIcon({ size })
    case 'killed':
    case 'error': return ErrorDotIcon({ size })
    default: return null
  }
}

/** The config tree component. */
export function ConfigTree(props: ConfigTreeProps): ReactNode {
  const { configs, instances, selectedInstanceId, selectedConfigId,
    onSelectConfig, onSelectInstance, onStartConfig, onStopInstance, onEditConfig } = props

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggleGroup = (type: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // Group configs by type, ordered by TYPE_ORDER, sorted by lastRunAt desc.
  const groups = useMemo(() => {
    const map = new Map<string, RunConfig[]>()
    for (const config of configs) {
      const arr = map.get(config.type) ?? []
      arr.push(config)
      map.set(config.type, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
    }
    return TYPE_ORDER
      .filter((type) => map.has(type) && map.get(type)!.length > 0)
      .map((type) => ({ type, items: map.get(type)! }))
  }, [configs])

  if (configs.length === 0) {
    return createElement('div', { className: 'sts-empty' },
      '暂无运行配置',
      createElement('br'),
      '点击右上角 + 新建配置',
    )
  }

  return createElement('div', { className: 'sts-tree' },
    ...groups.map((group) => {
      const isCollapsed = collapsed.has(group.type)
      const label = TYPE_LABELS[group.type] ?? group.type
      const runningCount = instances.filter(
        (inst) => inst.configType === group.type && inst.status === 'running',
      ).length

      return createElement('div', { key: group.type },
        // Group header
        createElement('div', {
          className: 'sts-group-header',
          onClick: () => toggleGroup(group.type),
        },
          isCollapsed
            ? createElement(ChevronRightIcon, { size: 12 })
            : createElement(ChevronDownIcon, { size: 12 }),
          typeIcon(group.type, 14),
          label,
          createElement('span', { className: 'sts-group-count' },
            ` (${group.items.length}${runningCount > 0 ? `, ${runningCount} 运行中` : ''})`,
          ),
        ),
        // Group children
        createElement('div', {
          className: `sts-group-children${isCollapsed ? ' collapsed' : ''}`,
        },
          ...group.items.flatMap((config) => {
            const configInstances = instances.filter((inst) => inst.configId === config.id)
            const isRunning = configInstances.some((inst) => inst.status === 'running')
            const isSelected = selectedConfigId === config.id && selectedInstanceId === null

            const rows: ReactNode[] = [
              // Config row
              createElement('div', {
                key: config.id,
                className: `sts-config-row${isSelected ? ' selected' : ''}${isRunning ? ' running' : ''}`,
                onClick: () => onSelectConfig(config.id),
              },
                isRunning
                  ? RunningDotIcon({ size: 12 })
                  : typeIcon(config.type, 12),
                createElement('div', { className: 'sts-config-name' }, config.name),
                createElement('div', { className: 'sts-config-cmd' }, config.command),
                createElement('div', { className: 'sts-config-actions' },
                  isRunning
                    ? createElement('button', {
                        className: 'sts-icon-btn stop',
                        title: '停止全部',
                        onClick: (e: MouseEvent) => {
                          e.stopPropagation()
                          for (const inst of configInstances) {
                            if (inst.status === 'running') onStopInstance(inst.id)
                          }
                        },
                      }, StopIcon({ size: 14 }))
                    : createElement('button', {
                        className: 'sts-icon-btn play',
                        title: '启动',
                        onClick: (e: MouseEvent) => {
                          e.stopPropagation()
                          onStartConfig(config.id)
                        },
                      }, PlayIcon({ size: 14 })),
                  createElement('button', {
                    className: 'sts-icon-btn gear',
                    title: '编辑',
                    onClick: (e: MouseEvent) => {
                      e.stopPropagation()
                      onEditConfig(config.id)
                    },
                  }, GearIcon({ size: 12 })),
                ),
              ),
            ]

            // Instance rows (children)
            for (const inst of configInstances) {
              const instSelected = selectedInstanceId === inst.id
              rows.push(
                createElement('div', {
                  key: inst.id,
                  className: `sts-instance-row${instSelected ? ' selected' : ''}`,
                  onClick: () => onSelectInstance(inst.id),
                },
                  statusIcon(inst.status, 10),
                  `#${inst.id.slice(0, 8)}`,
                  createElement('span', { className: 'sts-instance-pid' },
                    inst.status === 'running' ? ` pid:${inst.pid}` : ` ${inst.status}`,
                  ),
                  inst.status === 'running'
                    ? createElement('button', {
                        className: 'sts-icon-btn stop',
                        title: '停止',
                        onClick: (e: MouseEvent) => {
                          e.stopPropagation()
                          onStopInstance(inst.id)
                        },
                      }, StopIcon({ size: 12 }))
                    : null,
                ),
              )
            }

            return rows
          }),
        ),
      )
    }),
  )
}
