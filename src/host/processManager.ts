/**
 * Process manager: spawns child processes for run configurations, collects
 * stdout/stderr into a ring buffer, and fans logs out to WebSocket subscribers.
 * One instance per spawned process. Instances persist briefly after exit
 * so late-attaching browsers can read the final log.
 * @module dsh-better-sidebar-starter/host/processManager
 */

import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocket, type WebSocket as WsType } from 'ws'
import type { RunConfig, RunConfigType } from './configStore.ts'

/**
 * Resolve JAVA_HOME from the system when it is not already in the process
 * environment. Checks (in order):
 * 1. process.env.JAVA_HOME
 * 2. Windows registry (HKLM\SOFTWARE\JavaSoft\JDK / JRE)
 * 3. Common install paths
 * 4. `which java` → parent dir (Unix)
 * Returns null if not found.
 */
function resolveJavaHome(): string | null {
  // 1. Already in env — but verify the path is valid (has bin/java or bin/java.exe).
  if (process.env.JAVA_HOME && process.env.JAVA_HOME.trim() !== '') {
    const home = process.env.JAVA_HOME.trim()
    const javaBin = existsSync(join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
    if (javaBin) return home
    // JAVA_HOME is set but invalid — fall through to discovery.
  }

  if (process.platform === 'win32') {
    // 2. Windows registry: check JDK then JRE keys (both 64-bit and 32-bit).
    const regPaths = [
      'HKLM\\SOFTWARE\\JavaSoft\\JDK',
      'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit',
      'HKLM\\SOFTWARE\\JavaSoft\\JRE',
      'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JDK',
      'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Development Kit',
      'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JRE',
    ]
    for (const regPath of regPaths) {
      try {
        // reg query returns "JavaHome    REG_SZ    C:\Program Files\Java\jdk-17"
        const output = execFileSync('reg', ['query', regPath, '/s', '/v', 'JavaHome'], {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
        })
        const match = output.match(/JavaHome\s+REG_SZ\s+(.+)/)
        if (match !== null) {
          const home = match[1].trim()
          if (existsSync(home)) return home
        }
      } catch { /* registry key not found — try next */ }
    }

    // 3. Common Windows install paths.
    const userHome = process.env.USERPROFILE ?? ''
    const candidates = [
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Java'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Java'),
      // IntelliJ-managed JDKs
      join(userHome, '.jdks'),
      // Android Studio / IntelliJ bundled JBR
      join(userHome, '.jdks', 'jbr-21.0.11'),
    ]
    for (const base of candidates) {
      try {
        if (!existsSync(base)) continue
        const dirs = execFileSync('cmd', ['/c', 'dir', '/b', '/ad', base], {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
        }).split('\n').map((s) => s.trim()).filter((s) => s !== '')
        // Check each dir for bin/java.exe, pick the highest-version JDK.
        let best: string | null = null
        let bestVer = -1
        for (const d of dirs) {
          const home = join(base, d)
          if (!existsSync(join(home, 'bin', 'java.exe'))) continue
          // Extract version number from dir name (e.g. corretto-17.0.19 → 17).
          const verMatch = d.match(/(\d+)(?:\.|$)/)
          const ver = verMatch !== null ? parseInt(verMatch[1], 10) : 0
          // Prefer real JDKs (corretto/temurin/jdk) over JBR (runtime only).
          const isRealJdk = /jdk|corretto|temurin/i.test(d)
          const score = ver + (isRealJdk ? 1000 : 0)
          if (score > bestVer) {
            bestVer = score
            best = home
          }
        }
        if (best !== null) return best
      } catch { /* dir failed — try next */ }
    }
  } else {
    // Unix: try `readlink -f $(which java)` → strip /bin/java.
    try {
      const javaPath = execFileSync('which', ['java'], { encoding: 'utf8', timeout: 3000 }).trim()
      if (javaPath !== '') {
        const realPath = execFileSync('readlink', ['-f', javaPath], { encoding: 'utf8', timeout: 3000 }).trim()
        // /usr/lib/jvm/.../bin/java → /usr/lib/jvm/...
        const home = realPath.replace(/\/bin\/java$/, '')
        if (home !== realPath && existsSync(home)) return home
      }
    } catch { /* not found */ }
  }

  return null
}

/** Resolve the Maven bin dir. Priority: config.runtime.mvn > a configured
 *  MVN_PATH > process.env.MAVEN_HOME > `where mvn` / `which mvn`. */
function resolveMavenBin(configRuntime: RunConfig['runtime'] | undefined, globalEnv: Record<string, string>): string | null {
  // 1. config runtime override (dir or path to mvn).
  const rtMvn = configRuntime?.mvn?.trim()
  if (rtMvn) {
    // Accept either a dir (…/bin or …/maven) or a path to mvn[.cmd].
    if (existsSync(rtMvn)) {
      const base = /mvn(\.cmd|\.bat)?$/i.test(rtMvn) ? rtMvn.replace(/[/\\]mvn(\.cmd|\.bat)?$/i, '') : rtMvn
      const binDir = /[/\\]bin$/i.test(base) ? base : join(base, 'bin')
      const exe = process.platform === 'win32' ? 'mvn.cmd' : 'mvn'
      if (existsSync(join(binDir, exe))) return binDir
    }
  }
  // 2. Global MVN_PATH.
  const gMvn = globalEnv.MVN_PATH?.trim()
  if (gMvn) {
    const binDir = /[/\\]bin$/i.test(gMvn) ? gMvn : join(gMvn, 'bin')
    const exe = process.platform === 'win32' ? 'mvn.cmd' : 'mvn'
    if (existsSync(join(binDir, exe))) return binDir
  }
  // 3. MAVEN_HOME env.
  const mh = process.env.MAVEN_HOME?.trim()
  if (mh) {
    const binDir = /[/\\]bin$/i.test(mh) ? mh : join(mh, 'bin')
    const exe = process.platform === 'win32' ? 'mvn.cmd' : 'mvn'
    if (existsSync(join(binDir, exe))) return binDir
  }
  // 4. which mvn.
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const arg = process.platform === 'win32' ? 'mvn.cmd' : 'mvn'
    const out = execFileSync(which, [arg], { encoding: 'utf8', timeout: 3000, windowsHide: true })
      .split('\n')[0]?.trim()
    if (out) {
      const lastSep = Math.max(out.lastIndexOf('/'), out.lastIndexOf('\\'))
      return lastSep >= 0 ? out.substring(0, lastSep) : out
    }
  } catch { /* not found */ }
  return null
}

/** Resolve a tool path from config runtime, global env, process env, or PATH. */
function resolveToolPath(
  configRuntime: RunConfig['runtime'] | undefined,
  globalEnv: Record<string, string>,
  key: 'java' | 'node' | 'python',
  envVar: string,
  whichName: string,
): string | null {
  // 1. config runtime override.
  const rt = configRuntime?.[key]?.trim()
  if (rt && existsSync(rt)) {
    const bin = existsSync(join(rt, 'bin')) && (key === 'java' || key === 'node')
      ? join(rt, 'bin')
      : /[/\\]bin$/i.test(rt) ? rt : join(rt, 'bin')
    return /[/\\]bin$/i.test(rt) ? rt : rt
  }
  // 2. global env.
  const gEnv = globalEnv[envVar]?.trim()
  if (gEnv && existsSync(gEnv)) return gEnv
  // 3. process env.
  const pEnv = process.env[envVar]?.trim()
  if (pEnv && existsSync(pEnv)) return pEnv
  return null
}

/** Build the spawn env. Priority: config.runtime > globalEnv > process.env >
 *  auto-detect. Injects tool bin dirs into PATH (fixes missing mvn/node/etc). */
function buildEnv(config: RunConfig, globalEnv: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...globalEnv, ...config.env }
  const isWin = process.platform === 'win32'
  const sep = isWin ? ';' : ':'
  const toolBins: string[] = []

  // ---- Java (JAVA_HOME) ----
  const javaHome = config.runtime?.java?.trim()
    || globalEnv.JAVA_HOME?.trim()
    || (process.env.JAVA_HOME?.trim() && existsSync(join(process.env.JAVA_HOME, 'bin', isWin ? 'java.exe' : 'java')) ? process.env.JAVA_HOME.trim() : '')
  let resolvedJava = javaHome && existsSync(join(javaHome, 'bin', isWin ? 'java.exe' : 'java')) ? javaHome : ''
  if (!resolvedJava) resolvedJava = resolveJavaHome() ?? ''
  if (resolvedJava) {
    env.JAVA_HOME = resolvedJava
    toolBins.push(join(resolvedJava, 'bin'))
  }

  // ---- Node ----
  const nodeHome = config.runtime?.node?.trim()
    || globalEnv.NODE_PATH?.trim()
    || (process.env.NODE_PATH?.trim() || '')
  let resolvedNode = ''
  if (nodeHome) {
    const binDir = /[/\\]bin$/i.test(nodeHome) ? nodeHome : join(nodeHome, 'bin')
    const nodeExe = isWin ? 'node.exe' : 'node'
    if (existsSync(join(binDir, nodeExe))) {
      resolvedNode = binDir
    } else if (existsSync(join(nodeHome, nodeExe))) {
      resolvedNode = nodeHome
    }
  }
  if (resolvedNode) {
    env.NODE_PATH = resolvedNode.replace(/[/\\]bin$/, '')
    toolBins.push(resolvedNode)
  }

  // ---- Python ----
  const pythonHome = config.runtime?.python?.trim()
    || globalEnv.PYTHON_PATH?.trim()
    || (process.env.PYTHON_PATH?.trim() || '')
  let resolvedPython = ''
  if (pythonHome) {
    const binDir = /[/\\]bin$/i.test(pythonHome) ? pythonHome : join(pythonHome, 'bin')
    const pyNames = isWin ? ['python.exe'] : ['python', 'python3']
    const hasPy = pyNames.some((n) => existsSync(join(binDir, n)))
    const hasPyRoot = pyNames.some((n) => existsSync(join(pythonHome, n)))
    if (hasPy) resolvedPython = binDir
    else if (hasPyRoot) resolvedPython = pythonHome
  }
  if (resolvedPython) {
    env.PYTHON_PATH = resolvedPython.replace(/[/\\]bin$/, '')
    toolBins.push(resolvedPython)
  }

  // ---- Maven (mvn) ----
  const mvnBin = resolveMavenBin(config.runtime, globalEnv)
  if (mvnBin) {
    env.MAVEN_HOME = mvnBin.replace(/[/\\]bin$/, '')
    toolBins.push(mvnBin)
  }

  // ---- Ensure the Windows system directories are on PATH ----
  // The dsh web host process may start with a trimmed PATH that lacks
  // System32 (so chcp/where/find etc. are not resolvable). Explicitly add
  // the standard system dirs so spawned commands can find system tools.
  if (isWin) {
    const windir = process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows'
    const sys32 = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32')
      : 'C:\\Windows\\System32'
    const sysNative = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'SysWOW64')
      : 'C:\\Windows\\SysWOW64'
    for (const d of [windir, sys32, sysNative]) {
      if (d && !toolBins.includes(d)) toolBins.push(d)
    }
  }

  // ---- Force UTF-8 output from child processes ----
  // Windows shells default to the GBK code page, and JDK ≤17 writes console
  // output in the platform charset (GBK) — both produce U+FFFD when the host
  // decodes UTF-8. Pin the common runtimes to UTF-8 (chcp 65001 already
  // covers cmd.exe). Existing user-provided values are respected.
  if (env.JAVA_TOOL_OPTIONS === undefined || env.JAVA_TOOL_OPTIONS === '') {
    env.JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8'
  }
  if (env.PYTHONIOENCODING === undefined || env.PYTHONIOENCODING === '') {
    env.PYTHONIOENCODING = 'utf-8'
  }

  // Prepend all tool bin dirs to PATH so mvn/node/python/system resolve.
  if (toolBins.length > 0) {
    const existing = env.PATH ?? ''
    env.PATH = [...toolBins, existing].filter(Boolean).join(sep)
  }

  return env
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
  /** Streaming UTF-8 decoder (keeps multi-byte chars intact across chunks). */
  utf8Decoder: TextDecoder
}

/** Decode one output chunk: streaming UTF-8 (no split-char artifacts), with a
 *  GBK fallback when the bytes are clearly not valid UTF-8 (legacy Windows
 *  output); the fallback only wins when it produces fewer replacement chars. */
function decodeChunk(decoder: TextDecoder, chunk: Buffer): string {
  let text = decoder.decode(chunk, { stream: true })
  if (text.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk').decode(chunk)
      const count = (s: string): number => s.split('\uFFFD').length - 1
      if (count(gbk) < count(text)) text = gbk
    } catch {
      /* 'gbk' unsupported (small-icu) — keep the UTF-8 result */
    }
  }
  return text
}

/**
 * Process manager owns the instance table and the WebSocket fan-out.
 * Call `spawn(config, cwd)` to start, `stop(instanceId)` to kill, and
 * `attach(instanceId, ws)` to subscribe a browser to the log stream.
 */
export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>()

  /** Spawn a config as a child process. Returns the new RunInstance. */
  spawnConfig(config: RunConfig, resolvedCwd: string, globalEnv: Record<string, string> = {}): RunInstance {
    const id = randomUUID()
    const now = Date.now()

    // Build the final command.
    let finalCommand = config.command
    if (config.type === 'springboot') {
      // For Spring Boot, JVM args and program args must be passed to the Maven
      // Spring Boot plugin as -D properties, NOT appended after the goal — Maven
      // would otherwise treat them as lifecycle phases (e.g. `mx512M`).
      //   JVM:       -Dspring-boot.run.jvmArguments="..."
      //   Arguments: -Dspring-boot.run.arguments="..."
      const parts: string[] = [config.command]
      const jvm = config.jvmArgs?.trim() ?? ''
      const appArgs = config.args?.trim() ?? ''
      // Only inject via the plugin property if the command actually runs the
      // spring-boot goal; otherwise append raw (custom command).
      const isSpringBootGoal = /spring-boot\s*:/i.test(config.command) || /^mvn\w*\s+spring-boot/i.test(config.command)
      if (isSpringBootGoal) {
        if (jvm !== '') {
          parts.push(`-Dspring-boot.run.jvmArguments="${jvm}"`)
        }
        if (appArgs !== '') {
          parts.push(`-Dspring-boot.run.arguments="${appArgs}"`)
        }
      } else {
        if (jvm !== '') parts.push(jvm)
        if (appArgs !== '') parts.push(appArgs)
      }
      finalCommand = parts.join(' ')
    } else if (config.args && config.args.trim()) {
      finalCommand = `${config.command} ${config.args.trim()}`
    }

    const instance: RunInstance = {
      id,
      configId: config.id,
      configName: config.name,
      configType: config.type,
      command: finalCommand,
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
      utf8Decoder: new TextDecoder('utf-8'),
    }

    let child: ReturnType<typeof spawn>
    try {
      // On Windows, pipes default to the console code page (often GBK/936),
      // which garbles UTF-8 -> UTF-8 decoding in this host. Prefix `chcp 65001`
      // so the spawned command emits UTF-8 bytes that match our utf8 decoding.
      const cmd = process.platform === 'win32' && !/^chcp\s/i.test(finalCommand)
        ? `chcp 65001 >nul && ${finalCommand}`
        : finalCommand
      child = spawn(cmd, {
        cwd: resolvedCwd,
        env: buildEnv(config, globalEnv),
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
      this.appendLog(managed, 'stdout', decodeChunk(managed.utf8Decoder, chunk))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      this.appendLog(managed, 'stderr', decodeChunk(managed.utf8Decoder, chunk))
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
