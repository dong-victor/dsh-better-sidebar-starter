/**
 * Services tab: the main sidebar panel component. Left 1/3 config tree,
 * right 2/3 log view or config detail. Manages config CRUD via the host
 * REST API and tracks running instances.
 * @module dsh-better-sidebar-starter/client/ServicesTab
 */

import { createElement, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import type { RunConfig, RunInstance } from './types.ts'
import { ConfigTree } from './ConfigTree.tsx'
import { LogView } from './LogView.tsx'
import { LogHistoryView } from './LogHistoryView.tsx'
import { ConfigDetail } from './ConfigDetail.tsx'
import { ConfigEditorModal, type ConfigEditorModalProps } from './ConfigEditorModal.tsx'
import { RocketIcon, PlusIcon, FileIcon } from './icons.tsx'
import { STYLES_CSS } from './styles.ts'

/** API base. */
const API_BASE = '/api/dsh-better-sidebar-starter'

/** Instance poll interval (ms). */
const POLL_INTERVAL = 3000

/** Inject styles once. */
let STYLES_INJECTED = false
function injectStyles(): void {
  if (STYLES_INJECTED) return
  STYLES_INJECTED = true
  const tag = document.createElement('style')
  tag.id = 'dsh-better-sidebar-starter-styles'
  tag.setAttribute('data-plugin', '@dong-victor/dsh-better-sidebar-starter')
  tag.textContent = STYLES_CSS
  document.head.appendChild(tag)
}

/** The main services tab component. */
export function ServicesTab(props: TabComponentProps): ReactNode {
  injectStyles()

  const { scope, store } = props
  const [configs, setConfigs] = useState<RunConfig[]>([])
  const [instances, setInstances] = useState<RunInstance[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [editingConfig, setEditingConfig] = useState<ConfigEditorModalProps['config'] | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [splitRatio, setSplitRatio] = useState(0.33)
  const [dragging, setDragging] = useState(false)
  const [isHorizontal, setIsHorizontal] = useState(true) // true = left/right split (right panel), false = top/bottom (bottom panel)
  const [historyOpen, setHistoryOpen] = useState(false) // persisted log browser

  const containerRef = useRef<HTMLDivElement>(null)

  // Detect panel orientation via ResizeObserver (aspect ratio).
  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const check = (): void => {
      const rect = el.getBoundingClientRect()
      // If wider than tall → horizontal split (left/right). If taller → vertical (top/bottom).
      setIsHorizontal(rect.width > rect.height * 1.2)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Read split ratio from plugin settings on mount.
  useEffect(() => {
    const blob = store.getPrefs()?.pluginSettings?.['dsh-better-sidebar-starter:services'] ?? {}
    if (typeof blob.splitRatio === 'number') {
      setSplitRatio(Math.max(0.2, Math.min(0.5, blob.splitRatio)))
    }
  }, [store])

  /** Persist split ratio to plugin settings. */
  const persistSplitRatio = useCallback((ratio: number): void => {
    const service = (store as any).service
    if (service !== undefined && typeof service.updateTab === 'function') {
      // Use pluginSettings persistence if available.
    }
  }, [store])

  /** Build a query string for the session scope. */
  const sessionQuery = useCallback((): string => {
    const params = new URLSearchParams({ sessionId: scope.sessionId })
    if (scope.cwd !== undefined) params.set('cwd', scope.cwd)
    return params.toString()
  }, [scope])

  /** Fetch configs from the host. */
  const fetchConfigs = useCallback(async (): Promise<void> => {
    try {
      const resp = await fetch(`${API_BASE}/configs?${sessionQuery()}`)
      if (resp.ok) {
        const data = await resp.json() as { configs: RunConfig[] }
        setConfigs(data.configs)
      }
    } catch { /* network error — ignore */ }
  }, [sessionQuery])

  /** Fetch instances from the host. */
  const fetchInstances = useCallback(async (): Promise<void> => {
    try {
      const resp = await fetch(`${API_BASE}/instances?${sessionQuery()}`)
      if (resp.ok) {
        const data = await resp.json() as { instances: RunInstance[] }
        setInstances(data.instances)
      }
    } catch { /* network error — ignore */ }
  }, [sessionQuery])

  // Initial load.
  useEffect(() => {
    void fetchConfigs()
    void fetchInstances()
  }, [fetchConfigs, fetchInstances])

  // Poll instances.
  useEffect(() => {
    const timer = setInterval(() => void fetchInstances(), POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [fetchInstances])

  /** Start a config. */
  const handleStart = useCallback(async (configId: string): Promise<void> => {
    try {
      // Read global env paths from plugin settings.
      const blob = store.getPrefs()?.pluginSettings?.['dsh-better-sidebar-starter:services'] ?? {}
      const globalEnv: Record<string, string> = {}
      if (typeof blob.javaHome === 'string' && blob.javaHome.trim() !== '') globalEnv.JAVA_HOME = blob.javaHome.trim()
      if (typeof blob.nodePath === 'string' && blob.nodePath.trim() !== '') globalEnv.NODE_PATH = blob.nodePath.trim()
      if (typeof blob.pythonPath === 'string' && blob.pythonPath.trim() !== '') globalEnv.PYTHON_PATH = blob.pythonPath.trim()
      if (typeof blob.mvnPath === 'string' && blob.mvnPath.trim() !== '') globalEnv.MVN_PATH = blob.mvnPath.trim()

      const resp = await fetch(`${API_BASE}/run?${sessionQuery()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ configId, globalEnv }),
      })
      if (resp.ok) {
        const data = await resp.json() as { instance: RunInstance }
        setSelectedInstanceId(data.instance.id)
        setSelectedConfigId(null)
        void fetchInstances()
        void fetchConfigs() // lastRunAt update
      }
    } catch { /* ignore */ }
  }, [sessionQuery, fetchInstances, fetchConfigs, store])

  /** Stop an instance. */
  const handleStop = useCallback(async (instanceId: string): Promise<void> => {
    try {
      await fetch(`${API_BASE}/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId }),
      })
      void fetchInstances()
    } catch { /* ignore */ }
  }, [fetchInstances])

  /** Restart = stop + start the same config. */
  const handleRestart = useCallback(async (instanceId: string): Promise<void> => {
    const inst = instances.find((i) => i.id === instanceId)
    if (inst === undefined) return
    await handleStop(instanceId)
    // Small delay to let the process die.
    await new Promise((r) => setTimeout(r, 200))
    await handleStart(inst.configId)
  }, [instances, handleStop, handleStart])

  /** Open the new config modal. */
  const handleNewConfig = (): void => {
    setEditingConfig(null)
    setShowModal(true)
  }

  /** Open the edit config modal. */
  const handleEditConfig = (configId: string): void => {
    const config = configs.find((c) => c.id === configId)
    if (config === undefined) return
    setEditingConfig({
      id: config.id,
      name: config.name,
      type: config.type,
      command: config.command,
      cwd: config.cwd,
      env: config.env,
      jvmArgs: config.jvmArgs,
      args: config.args,
      runtime: config.runtime,
    })
    setShowModal(true)
  }

  /**
   * Duplicate a config: open the editor prefilled with ALL of the original
   * config's info under an auto-generated "xxx-副本" name (deduped against
   * existing names). Saving it (id omitted) creates a brand-new config.
   */
  const handleDuplicateConfig = (configId: string): void => {
    const config = configs.find((c) => c.id === configId)
    if (config === undefined) return
    // Derive a unique copy name: strip a trailing "-副本", then append
    // "-副本" (or "-副本2", "-副本3", …) while avoiding collisions.
    const stem = config.name.endsWith('-副本') ? config.name.slice(0, -3) : config.name
    const taken = new Set(configs.map((c) => c.name))
    let dupName = `${stem}-副本`
    let suffix = 2
    while (taken.has(dupName)) {
      dupName = `${stem}-副本${suffix}`
      suffix++
    }
    setEditingConfig({
      // No id → saving creates a new config instead of updating the source.
      name: dupName,
      type: config.type,
      command: config.command,
      cwd: config.cwd,
      env: config.env,
      jvmArgs: config.jvmArgs,
      args: config.args,
      runtime: config.runtime,
    })
    setShowModal(true)
  }

  /** Save a config (create or update). */
  const handleSaveConfig = useCallback(async (config: ConfigEditorModalProps['config']): Promise<void> => {
    try {
      const resp = await fetch(`${API_BASE}/configs?${sessionQuery()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      if (resp.ok) {
        setShowModal(false)
        setEditingConfig(null)
        void fetchConfigs()
      }
    } catch { /* ignore */ }
  }, [sessionQuery, fetchConfigs])

  /** Delete a config. */
  const handleDeleteConfig = useCallback(async (configId: string): Promise<void> => {
    // Stop any running instances first.
    for (const inst of instances) {
      if (inst.configId === configId && inst.status === 'running') {
        await handleStop(inst.id)
      }
    }
    try {
      const resp = await fetch(`${API_BASE}/configs?${sessionQuery()}&id=${encodeURIComponent(configId)}`, {
        method: 'DELETE',
      })
      if (resp.ok) {
        if (selectedConfigId === configId) setSelectedConfigId(null)
        void fetchConfigs()
        void fetchInstances()
      }
    } catch { /* ignore */ }
  }, [instances, handleStop, sessionQuery, fetchConfigs, fetchInstances, selectedConfigId])

  /** Select a config (deselect any instance). */
  const handleSelectConfig = (configId: string): void => {
    setSelectedConfigId(configId)
    setSelectedInstanceId(null)
  }

  /** Select an instance. */
  const handleSelectInstance = (instanceId: string): void => {
    setSelectedInstanceId(instanceId)
    setSelectedConfigId(null)
  }

  // -- Split pane drag handling --
  const handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault()
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e: MouseEvent): void => {
      if (containerRef.current === null) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = isHorizontal
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height
      const clamped = Math.max(0.2, Math.min(0.5, ratio))
      setSplitRatio(clamped)
      persistSplitRatio(clamped)
    }
    const handleUp = (): void => setDragging(false)
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, isHorizontal, persistSplitRatio])

  // Resolve what to show in the right pane.
  const selectedInstance = selectedInstanceId !== null
    ? instances.find((i) => i.id === selectedInstanceId) ?? null
    : null
  const selectedConfig = selectedConfigId !== null
    ? configs.find((c) => c.id === selectedConfigId) ?? null
    : null

  return createElement('div', { ref: containerRef, className: 'sts-root' },
    // Toolbar
    createElement('div', { className: 'sts-toolbar' },
      createElement('div', { className: 'sts-toolbar-title' },
        createElement(RocketIcon, { size: 16 }),
        '服务',
      ),
      createElement('button', {
        className: 'sts-toolbar-btn',
        onClick: handleNewConfig,
      },
        createElement(PlusIcon, { size: 13 }), '新建配置'),
      createElement('button', {
        className: `sts-toolbar-btn${historyOpen ? ' active' : ''}`,
        title: '查看持久化历史日志（.dsh/logs，含启动失败记录）',
        onClick: () => {
          setHistoryOpen((v) => !v)
          if (historyOpen) { /* keep selection; returning shows it again */ }
        },
      },
        createElement(FileIcon, { size: 13 }), '历史日志'),
    ),
    // Split pane (horizontal or vertical based on panel position)
    createElement('div', { className: `sts-split${isHorizontal ? '' : ' sts-split-vertical'}` },
      // First pane: config tree
      createElement('div', {
        className: `sts-split-first${isHorizontal ? '' : ' sts-split-first-v'}`,
        style: isHorizontal
          ? { width: `${splitRatio * 100}%` }
          : { height: `${splitRatio * 100}%` },
      },
        configs.length === 0
          ? createElement('div', { className: 'sts-empty' }, '暂无运行配置，点击右上角 + 新建')
          : createElement(ConfigTree, {
              configs,
              instances,
              selectedInstanceId,
              selectedConfigId,
              onSelectConfig: handleSelectConfig,
              onSelectInstance: handleSelectInstance,
              onStartConfig: (id: string) => { void handleStart(id) },
              onStopInstance: (id: string) => { void handleStop(id) },
              onEditConfig: handleEditConfig,
              onDuplicateConfig: handleDuplicateConfig,
            }),
      ),
      // Gutter
      createElement('div', {
        className: `sts-split-gutter${dragging ? ' dragging' : ''}${isHorizontal ? '' : ' sts-split-gutter-v'}`,
        onMouseDown: handleMouseDown,
      }),
      // Second pane: log view or config detail or history or empty
      createElement('div', { className: `sts-split-second${isHorizontal ? '' : ' sts-split-second-v'}` },
        historyOpen
          ? createElement(LogHistoryView, {
              ctx: props.ctx,
              sessionId: scope.sessionId ?? store.getSnapshot().sessionId ?? '',
              cwd: scope.cwd,
              onClose: () => setHistoryOpen(false),
            })
          : selectedInstance !== null
            ? createElement(LogView, {
                instance: selectedInstance,
                ctx: props.ctx,
                sessionId: scope.sessionId ?? store.getSnapshot().sessionId ?? '',
                cwd: scope.cwd,
                onStop: () => { void handleStop(selectedInstance.id) },
                onRestart: () => { void handleRestart(selectedInstance.id) },
              })
            : selectedConfig !== null
              ? createElement(ConfigDetail, {
                  config: selectedConfig,
                  onStart: () => { void handleStart(selectedConfig.id) },
                  onEdit: () => handleEditConfig(selectedConfig.id),
                  onDuplicate: () => handleDuplicateConfig(selectedConfig.id),
                  onDelete: () => { void handleDeleteConfig(selectedConfig.id) },
                })
              : createElement('div', { className: 'sts-empty' }, '选择左侧配置查看详情或日志'),
      ),
    ),
    // Modal
    showModal
      ? createElement(ConfigEditorModal, {
          config: editingConfig,
          scope: { sessionId: scope.sessionId ?? store.getSnapshot().sessionId ?? '', cwd: scope.cwd },
          onSave: (c) => { void handleSaveConfig(c) },
          onCancel: () => { setShowModal(false); setEditingConfig(null) },
        })
      : null,
  )
}
