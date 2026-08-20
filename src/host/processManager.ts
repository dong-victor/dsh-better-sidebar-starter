/**
 * Process manager: spawns child processes for run configurations, collects
 * stdout/stderr into a ring buffer, and fans logs out to WebSocket subscribers.
 * One instance per spawned process. Instances persist briefly after exit
 * so late-attaching browsers can read the final log.
 * @module dsh-better-sidebar-starter/host/processManager
 */

import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { WebSocket, type WebSocket as WsType } from 'ws'
import type { RunConfig, RunConfigType } from './configStore.ts'

/** One running or recently-finished process instance. */
export interface RunInstance {
  id: string
  configId: string
  configName: string
  configType: RunConfigType
  command: string
  cwd: string
  status: 'running' | 'exited' | 'killed' | 'error'
  pid: number
  startedAt: number
  exitedAt: number | null
  exitCode: number | null
}

/** One log entry buffered in the ring buffer. */
export interface LogEntry {
  stream: 'stdout' | 'stderr'
  text: string
  ts: number
}

/** Ring buffer cap (1 MB of text; each entry's text counted as UTF-16 length). */
const RING_BUFFER_MAX_CHARS = 1_000_000

/** How long an exited instance stays available for late log reads. */
const EXIT_RETENTION_MS = 30_000

/** Managed process with its log buffer and WebSocket subscribers. */
interface ManagedProcess {
  instance: RunInstance
  child: ReturnType<typeof spawn> | null
  logs: LogEntry[]
  logChars: number
  subscribers: Set<WsType>
  exitTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Process manager owns the instance table and the WebSocket fan-out.
 * Call `spawn(config, cwd)` to start, `stop(instanceId)` to kill, and
 * `attach(instanceId, ws)` to subscribe a browser to the log stream.
 */
export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>()

  /** Spawn a config as a child process. Returns the new RunInstance. */
  spawnConfig(config: RunConfig, resolvedCwd: string): RunInstance {
    const id = randomUUID()
    const now = Date.now()
    const instance: RunInstance = {
      id,
      configId: config.id,
      configName: config.name,
      configType: config.type,
      command: config.command,
      cwd: resolvedCwd,
      status: 'running',
      pid: 0,
      startedAt: now,
      exitedAt: null,
      exitCode: null,
    }

    const managed: ManagedProcess = {
      instance,
      child: null,
      logs: [],
      logChars: 0,
      subscribers: new Set(),
      exitTimer: null,
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(config.command, {
        cwd: resolvedCwd,
        env: { ...process.env, ...config.env },
        shell: true,
        detached: process.platform !== 'win32',
        windowsHide: false,
      })
    } catch (error) {
      instance.status = 'error'
      instance.exitCode = -1
      instance.exitedAt = Date.now()
      this.processes.set(id, managed)
      this.scheduleCleanup(managed)
      const msg = error instanceof Error ? error.message : String(error)
      this.appendLog(managed, 'stderr', `Failed to spawn: ${msg}\n`)
      return instance
    }

    managed.child = child
    instance.pid = child.pid ?? 0
    this.processes.set(id, managed)

    child.stdout?.on('data', (chunk: Buffer) => {
      this.appendLog(managed, 'stdout', chunk.toString('utf8'))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      this.appendLog(managed, 'stderr', chunk.toString('utf8'))
    })
    child.on('error', (error) => {
      this.appendLog(managed, 'stderr', `Process error: ${error.message}\n`)
      this.setExited(managed, 'error', -1)
    })
    child.on('close', (code) => {
      this.setExited(managed, 'exited', code ?? 0)
    })

    return instance
  }

  /** Stop a running instance (kills the process tree). No-op if not running. */
  stop(instanceId: string): boolean {
    const managed = this.processes.get(instanceId)
    if (managed === undefined) return false
    if (managed.instance.status !== 'running') return false
    if (managed.child === null) return false

    const pid = managed.child.pid
    if (pid === undefined) return false

    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          process.kill(pid, 'SIGTERM')
        }
      }
    } catch {
      try {
        managed.child.kill('SIGTERM')
      } catch { /* already gone */ }
    }

    this.setExited(managed, 'killed', null)
    return true
  }

  /** List all instances (running + recently exited). */
  listInstances(): RunInstance[] {
    return Array.from(this.processes.values()).map((m) => m.instance)
  }

  /** Get one instance by id. */
  getInstance(instanceId: string): RunInstance | undefined {
    return this.processes.get(instanceId)?.instance
  }

  /** Get buffered logs for an instance. */
  getLogs(instanceId: string): LogEntry[] {
    return this.processes.get(instanceId)?.logs ?? []
  }

  /** Subscribe a WebSocket to an instance's log stream. */
  attach(instanceId: string, ws: WsType): boolean {
    const managed = this.processes.get(instanceId)
    if (managed === undefined) return false
    managed.subscribers.add(ws)
    ws.on('close', () => {
      managed.subscribers.delete(ws)
    })
    ws.on('error', () => {
      managed.subscribers.delete(ws)
    })
    return true
  }

  /** Append a log entry to the ring buffer and fan out to subscribers. */
  private appendLog(managed: ManagedProcess, stream: 'stdout' | 'stderr', text: string): void {
    const entry: LogEntry = { stream, text, ts: Date.now() }
    managed.logs.push(entry)
    managed.logChars += text.length
    // Ring buffer: drop oldest entries while over cap.
    while (managed.logChars > RING_BUFFER_MAX_CHARS && managed.logs.length > 1) {
      const dropped = managed.logs.shift()
      if (dropped !== undefined) managed.logChars -= dropped.text.length
    }
    // Fan out to subscribers.
    const msg = JSON.stringify({ type: 'log', entry })
    for (const ws of managed.subscribers) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg)
      } catch { /* subscriber will be cleaned on close */ }
    }
  }

  /** Mark an instance as exited and notify subscribers. */
  private setExited(managed: ManagedProcess, status: RunInstance['status'], exitCode: number | null): void {
    if (managed.instance.status !== 'running') return
    managed.instance.status = status
    managed.instance.exitedAt = Date.now()
    managed.instance.exitCode = exitCode

    const msg = JSON.stringify({ type: 'status', status, exitCode })
    for (const ws of managed.subscribers) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg)
      } catch { /* ignore */ }
    }

    this.scheduleCleanup(managed)
  }

  /** Schedule instance removal after the retention window. */
  private scheduleCleanup(managed: ManagedProcess): void {
    if (managed.exitTimer !== null) return
    managed.exitTimer = setTimeout(() => {
      this.processes.delete(managed.instance.id)
    }, EXIT_RETENTION_MS)
  }

  /** Stop all running processes and dispose (plugin teardown). */
  dispose(): void {
    for (const managed of this.processes.values()) {
      if (managed.exitTimer !== null) clearTimeout(managed.exitTimer)
      if (managed.instance.status === 'running' && managed.child !== null) {
        try {
          const pid = managed.child.pid
          if (pid !== undefined) {
            if (process.platform === 'win32') {
              execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
                windowsHide: true, stdio: 'ignore',
              })
            } else {
              try { process.kill(-pid, 'SIGTERM') } catch { process.kill(pid, 'SIGTERM') }
            }
          }
        } catch { /* gone */ }
      }
    }
    this.processes.clear()
  }
}
