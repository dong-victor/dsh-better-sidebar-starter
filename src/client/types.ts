/**
 * Shared client-side types, mirroring the host-side interfaces.
 * @module dsh-better-sidebar-starter/client/types
 */

/** Supported configuration types. */
export type RunConfigType = 'npm' | 'springboot' | 'python' | 'custom'

/** Per-config runtime tool overrides (optional; empty string = use global/system). */
export interface RunRuntime {
  java?: string
  node?: string
  python?: string
  mvn?: string
}

/** One persisted run configuration. */
export interface RunConfig {
  id: string
  name: string
  type: RunConfigType
  command: string
  cwd: string
  env: Record<string, string>
  /** JVM arguments (springboot only, e.g. "-Xmx512m -Dspring.profiles.active=dev"). */
  jvmArgs?: string
  /** Program arguments (appended after command, e.g. "--server.port=8080"). */
  args?: string
  /** Per-config runtime tool overrides. */
  runtime?: RunRuntime
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
}

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

/** One log entry. `meta` lines are host-authored (start/exit summary) and
 *  are only rendered in persisted history views. */
export interface LogEntry {
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
  ts: number
}

/** WebSocket message types from the server. */
export type WsMessage =
  | { type: 'history'; entries: LogEntry[] }
  | { type: 'log'; entry: LogEntry }
  | { type: 'status'; status: string; exitCode: number | null }
  | { type: 'error'; message: string }
