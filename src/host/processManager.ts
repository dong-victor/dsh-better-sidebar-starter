/**
 * Process manager: spawns child processes for run configurations, collects
 * stdout/stderr into a ring buffer, and fans logs out to WebSocket subscribers.
 * One instance per spawned process. Instances persist briefly after exit
 * so late-attaching browsers can read the final log.
 * @module dsh-better-sidebar-starter/host/processManager
 */

import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, openSync, closeSync, readSync, writeSync, fstatSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import os from 'node:os'
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
  // Always make the running host's own node directory resolvable so bare
  // `node` / `npm` / `npx` work in start commands even when the host process
  // was launched with a trimmed PATH. Configs should use short commands,
  // never absolute paths to node/npm.
  const selfNodeBin = dirname(process.execPath)
  if (!toolBins.some((d) => d.toLowerCase() === selfNodeBin.toLowerCase())) {
    toolBins.push(selfNodeBin)
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
  // Windows env keys are case-insensitive but this plain object is not:
  // process.env usually materializes the key as "Path", so normalize to a
  // single key or the child would get a duplicate PATH/Path block where
  // cmd.exe may pick the toolBins-only one and lose the original PATH.
  if (toolBins.length > 0) {
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? (isWin ? 'Path' : 'PATH')
    const existing = env[pathKey] ?? ''
    for (const k of Object.keys(env)) {
      if (k.toLowerCase() === 'path' && k !== pathKey) delete env[k]
    }
    env[pathKey] = [...toolBins, existing].filter(Boolean).join(sep)
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
  /** `stdout`/`stderr` carry process output; `meta` lines are host-authored
   *  (start command, exit summary) and also persisted. */
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
  ts: number
}

/** Ring buffer cap (1 MB of text; each entry's text counted as UTF-16 length). */
const RING_BUFFER_MAX_CHARS = 1_000_000

/** How long an exited instance stays available for late log reads. */
const EXIT_RETENTION_MS = 30_000

/** Managed process with its log buffer, persistent log file and subscribers. */
interface ManagedProcess {
  instance: RunInstance
  child: ReturnType<typeof spawn> | null
  logs: LogEntry[]
  logChars: number
  subscribers: Set<WsType>
  exitTimer: ReturnType<typeof setTimeout> | null
  /** Streaming UTF-8 decoder (keeps multi-byte chars intact across chunks). */
  utf8Decoder: TextDecoder
  /** Persistent log file path (`workspace/logs/<Name>_<ts>_<id8>.log`). */
  logPath: string
  /** Shared write handle on the log file (service stdout/stderr land here). */
  logFd: number | null
  /** File-size cursor of the tailer (bytes already read into the ring). */
  logSize: number
  /** Tailer interval: pushes new file bytes into the ring buffer. */
  tailTimer: ReturnType<typeof setInterval> | null
  /** True when this instance was adopted after a host restart (no child
   *  process events; liveness is polled by pid, output is file-tail only). */
  adopted: boolean
  /** Liveness poll for adopted instances. */
  pidPollTimer: ReturnType<typeof setInterval> | null
  /** Known descendant pids of the shell wrapper (npm/vite/java service...).
   *  The wrapper cmd.exe may exit before the service does, so the recorded
   *  pid alone cannot find the service after a host restart — the tree
   *  snapshot taken shortly after spawn is the fallback. */
  descendants: number[]
}

/** Escape characters that are unsafe in Windows file names. */
function safeFileName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_').slice(0, 60)
}

/** Build the persistent log file path for one run. The user asked for the
 *  logs under `<workspace>/logs/` (plain, no dot-prefix) so IDEA-like history
 *  is easy to find; the loader still reads the older `.dsh/logs` too. */
function logFilePath(logsRoot: string, config: RunConfig, id: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 14)
  const name = safeFileName(config.name)
  return join(logsRoot, 'logs', `${name}_${ts}_${id.slice(0, 8)}.log`)
}

/** Serialize one log entry into the persistent JSONL format. */
function serializeLogEntry(entry: LogEntry): string {
  return JSON.stringify({ ts: entry.ts, stream: entry.stream, text: entry.text }) + '\n'
}

// ---- Persistent run states (process adoption across host restarts) ----

interface RunState {
  id: string
  configId: string
  configName: string
  command: string
  cwd: string
  pid: number
  startedAt: number
  logFile: string
  /** Snapshot of descendant pids (see ManagedProcess.descendants). */
  descendants?: number[]
}

interface RunStatesFile {
  v: 1
  runs: RunState[]
}

const RUN_STATES_VERSION = 1 as const
const RUN_STATES_PATH = (): string => join(os.homedir(), '.dsh', 'starter-run-states.json')

let runStatesCache: RunState[] | null = null

/** Load run states (cached). */
async function loadRunStates(): Promise<RunState[]> {
  if (runStatesCache !== null) return runStatesCache
  try {
    const parsed = JSON.parse(await readFile(RUN_STATES_PATH(), 'utf8')) as RunStatesFile
    if (parsed.v === RUN_STATES_VERSION && Array.isArray(parsed.runs)) {
      runStatesCache = parsed.runs
      return runStatesCache
    }
  } catch { /* absent/corrupt */ }
  runStatesCache = []
  return runStatesCache
}

/** Persist the given run states (best-effort). */
async function saveRunStates(runs: RunState[]): Promise<void> {
  runStatesCache = runs
  try {
    const dir = join(os.homedir(), '.dsh')
    mkdirSync(dir, { recursive: true })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(RUN_STATES_PATH(), JSON.stringify({ v: RUN_STATES_VERSION, runs }), 'utf8')
  } catch { /* persistence is best-effort */ }
}

/** True when a pid is still alive. */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** All descendant pids of `rootPid` (BFS over the parent→children relation),
 *  shallowest first. Uses one PowerShell process-table snapshot; on any
 *  failure returns [] — callers must treat it as "unknown", not "empty". */
async function walkChildren(rootPid: number): Promise<number[]> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return []
  try {
    const { execFile } = await import('node:child_process')
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress -Depth 2',
      ], { windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
        if (err !== null) reject(err)
        else resolve(out)
      })
    })
    const parsed = JSON.parse(stdout) as Array<{ ProcessId: number; ParentProcessId: number }> | { ProcessId: number; ParentProcessId: number }
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const byParent = new Map<number, number[]>()
    for (const r of rows) {
      if (typeof r.ProcessId !== 'number' || typeof r.ParentProcessId !== 'number') continue
      const list = byParent.get(r.ParentProcessId)
      if (list === undefined) byParent.set(r.ParentProcessId, [r.ProcessId])
      else list.push(r.ProcessId)
    }
    // BFS from the root; children come before grandchildren.
    const out: number[] = []
    const queue = [rootPid]
    const seen = new Set<number>([rootPid])
    while (queue.length > 0) {
      const pid = queue.shift()!
      for (const child of byParent.get(pid) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        out.push(child)
        queue.push(child)
      }
    }
    return out
  } catch {
    return []
  }
}

/** Parse one persisted JSONL log file into LogEntry[]. Reading is bounded to
 *  the most recent `tail` lines (cheap line scan from the end). */
export async function readLogFile(filePath: string, tail = 5000): Promise<LogEntry[]> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n')
  let start = 0
  if (lines.length > tail) start = lines.length - tail
  const out: LogEntry[] = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as { ts?: unknown; stream?: unknown; text?: unknown }
      if (typeof parsed.ts !== 'number' || typeof parsed.text !== 'string') continue
      const stream = parsed.stream === 'stdout' || parsed.stream === 'stderr' || parsed.stream === 'meta'
        ? parsed.stream as LogEntry['stream']
        : 'stdout'
      out.push({ stream, text: parsed.text, ts: parsed.ts })
    } catch { /* skip non-JSON line (partial write) */ }
  }
  return out
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

  /** Spawn a config as a child process. Returns the new RunInstance.
   *  `logsRoot` is the workspace root used for the persistent `.dsh/logs`
   *  directory; omitted → falls back to `resolvedCwd`. */
  spawnConfig(config: RunConfig, resolvedCwd: string, globalEnv: Record<string, string> = {}, logsRoot?: string): RunInstance {
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
      logPath: join(resolvedCwd, '.dsh', 'logs', 'init.log'), // set below
      logFd: null,
      logSize: 0,
      tailTimer: null,
      adopted: false,
      pidPollTimer: null,
      descendants: [],
    }

    // Permanent log persistence: the service writes stdout/stderr straight
    // into <logsRoot>/logs/<Name>_<ts>_<id>.log via its own file descriptor
    // (see the spawn block below) — the process survives host restarts and
    // its output is always recoverable. We keep a mirrored ring buffer fed
    // by a file tailer for live streaming and late log history.
    let logFd: number | null = null
    try {
      const root = logsRoot ?? resolvedCwd
      managed.logPath = logFilePath(root, config, id)
      mkdirSync(join(root, 'logs'), { recursive: true })
      // 'a+' (read+append): the tailer reads the file back through this fd;
      // a write-only 'a' fd makes every readSync fail with EBADF.
      logFd = openSync(managed.logPath, 'a+')
      managed.logFd = logFd
    } catch { /* persistence failure must never break spawning */ }

    let child: ReturnType<typeof spawn>
    try {
      // On Windows, pipes default to the console code page (often GBK/936),
      // which garbles UTF-8 -> UTF-8 decoding in this host. Prefix `chcp 65001`
      // so the spawned command emits UTF-8 bytes that match our utf8 decoding.
      const cmd = process.platform === 'win32' && !/^chcp\s/i.test(finalCommand)
        ? `chcp 65001 >nul && ${finalCommand}`
        : finalCommand
      const stdioFd = logFd ?? ('ignore' as const)
      child = spawn(cmd, {
        cwd: resolvedCwd,
        env: buildEnv(config, globalEnv),
        shell: true,
        // POSIX: own process group so the tree survives and can be killed.
        // Windows: NOT detached — detached+shell drops the inherited log-file
        // handle before the grandchild service starts (verified empirically),
        // and Windows children already outlive the parent without it.
        detached: process.platform !== 'win32',
        windowsHide: false,
        // stdout/stderr go DIRECTLY to the log file. No pipe to this host:
        // when the host exits/restarts the service keeps running and keeps
        // logging; we only tail the file while we are alive.
        stdio: ['ignore', stdioFd, stdioFd],
      })
    } catch (error) {
      instance.status = 'error'
      instance.exitCode = -1
      instance.exitedAt = Date.now()
      this.processes.set(id, managed)
      this.writeMetaToFile(managed, `Failed to spawn: ${error instanceof Error ? error.message : String(error)}\n`)
      this.scheduleCleanup(managed)
      return instance
    }

    managed.child = child
    instance.pid = child.pid ?? 0
    this.processes.set(id, managed)

    // Meta line documenting the run in the file, then start the tailer.
    this.writeMetaToFile(managed, `[run] 启动命令: ${finalCommand}（cwd: ${resolvedCwd}）\n`)
    this.startTailer(managed)
    if (!instance.pid) instance.pid = 0

    child.on('error', (error) => {
      this.writeMetaToFile(managed, `Process error: ${error.message}\n`)
      this.setExited(managed, 'error', -1)
    })
    child.on('close', (code) => {
      this.handleWrapperExit(managed, code ?? 0)
    })

    // Remember the run for cross-restart adoption.
    void (async () => {
      const states = await loadRunStates()
      const next = states.filter((s) => s.id !== id)
      next.push({
        id, configId: config.id, configName: config.name, command: finalCommand,
        cwd: resolvedCwd, pid: instance.pid, startedAt: now, logFile: managed.logPath,
        descendants: [...managed.descendants],
      })
      await saveRunStates(next)
    })()

    // Snapshot the process tree shortly after spawn: the shell wrapper
    // (cmd.exe) may exit long before the actual service (npm/vite/java),
    // and only the tree snapshot lets a later host find the surviving
    // service pids. Two passes cover slow starters (mvn → spring-boot).
    const snapshotTree = (): void => {
      void walkChildren(instance.pid).then((kids) => {
        if (managed.instance.status !== 'running' || kids.length === 0) return
        for (const k of kids) if (!managed.descendants.includes(k)) managed.descendants.push(k)
        void (async () => {
          const states = await loadRunStates()
          const s = states.find((x) => x.id === id)
          if (s !== undefined) {
            s.descendants = [...managed.descendants]
            await saveRunStates(states)
          }
        })()
      })
    }
    setTimeout(snapshotTree, 3000)
    setTimeout(snapshotTree, 12000)

    return instance
  }

  /** Stop a running instance (kills the process tree). No-op if not running.
   *  Works for spawned and adopted (child === null) instances alike — both
   *  keep the process-tree root pid in `instance.pid`. */
  stop(instanceId: string): boolean {
    const managed = this.processes.get(instanceId)
    if (managed === undefined) return false
    if (managed.instance.status !== 'running') return false

    const pid = managed.instance.pid
    if (!Number.isInteger(pid) || pid <= 0) return false

    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else if (managed.child !== null) {
        try { process.kill(-pid, 'SIGTERM') } catch { process.kill(pid, 'SIGTERM') }
      } else {
        process.kill(pid, 'SIGTERM')
      }
    } catch {
      // Fall back to a plain kill on the child handle.
      if (managed.child !== null) {
        try { managed.child.kill('SIGTERM') } catch { /* already gone */ }
      }
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

  /** Subscribe a WebSocket to an instance's log stream. For adopted
   *  instances the ring buffer is empty after a restart — prefill it from
   *  the file tail and push a history frame so the client renders it. */
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
    if (managed.adopted && managed.logPath !== '') {
      void readLogFile(managed.logPath, 2000).then((entries) => {
        if (ws.readyState !== WebSocket.OPEN) return
        // Seed the ring so getLogs() also reflects the adopted history.
        if (managed.logs.length === 0) {
          managed.logs = entries.slice(-1000)
          managed.logChars = managed.logs.reduce((n, e) => n + e.text.length, 0)
        }
        ws.send(JSON.stringify({ type: 'history', entries }))
      })
    }
    return true
  }

  /** Write a host-authored line into the persistent log file. */
  private writeMetaToFile(managed: ManagedProcess, text: string): void {
    try {
      if (managed.logFd !== null && text !== '') {
        writeSync(managed.logFd, serializeLogEntry({ stream: 'meta', text, ts: Date.now() }))
      }
    } catch { /* file closed */ }
  }

  /** Poll the tail of the log file into the ring buffer (live streaming
   *  for instances whose stdout/stderr bypass this host via the file fd). */
  private startTailer(managed: ManagedProcess): void {
    this.stopTailer(managed)
    managed.logSize = 0
    managed.tailTimer = setInterval(() => {
      const fd = managed.logFd
      if (fd === null) return
      let size: number
      try {
        size = fstatSync(fd).size
      } catch { return }
      if (size <= managed.logSize) return
      const chunk = Buffer.alloc(size - managed.logSize)
      try {
        readSync(fd, chunk, 0, chunk.length, managed.logSize)
      } catch { return }
      managed.logSize += chunk.length
      this.appendLog(managed, 'stdout', decodeChunk(managed.utf8Decoder, chunk))
    }, 700)
  }

  private stopTailer(managed: ManagedProcess): void {
    if (managed.tailTimer !== null) {
      clearInterval(managed.tailTimer)
      managed.tailTimer = null
    }
  }

  private stopPidPoll(managed: ManagedProcess): void {
    if (managed.pidPollTimer !== null) {
      clearInterval(managed.pidPollTimer)
      managed.pidPollTimer = null
    }
  }

  /** Synchronously drain any not-yet-tailed file bytes into the ring.
   *  Called on exit/dispose: fast-failing services die before the first
   *  tailer tick, and their error output must still show up live. */
  private flushTailer(managed: ManagedProcess): void {
    const fd = managed.logFd
    if (fd === null) return
    let size: number
    try {
      size = fstatSync(fd).size
    } catch { return }
    if (size <= managed.logSize) return
    try {
      const chunk = Buffer.alloc(size - managed.logSize)
      readSync(fd, chunk, 0, chunk.length, managed.logSize)
      managed.logSize += chunk.length
      this.appendLog(managed, 'stdout', decodeChunk(managed.utf8Decoder, chunk))
    } catch { /* best-effort */ }
  }

  /** Close the log file handle and forget the tailer. */
  private closeLogFile(managed: ManagedProcess): void {
    this.stopTailer(managed)
    this.stopPidPoll(managed)
    try {
      if (managed.logFd !== null) {
        closeSync(managed.logFd)
        managed.logFd = null
      }
    } catch { /* already closed */ }
  }

  /** Append a log entry to the ring buffer and fan out to subscribers. The
   *  file itself is written by the service process (or the meta writer), so
   *  no double write happens here. */
  private appendLog(managed: ManagedProcess, stream: 'stdout' | 'stderr' | 'meta', text: string): void {
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

  /** The shell wrapper (cmd.exe) exited. That does NOT mean the service
   *  exited: npm/vite/java routinely outlive the wrapper. Check the process
   *  tree — if a descendant is still alive, promote it to the new tree root
   *  and keep tracking; only an empty tree ends the run. */
  private handleWrapperExit(managed: ManagedProcess, code: number): void {
    void (async () => {
      // Give orphaned descendants a moment to settle.
      await new Promise((r) => setTimeout(r, 800))
      if (managed.instance.status !== 'running') return
      const kids = await walkChildren(managed.instance.pid)
      const living = kids.filter(pidAlive)
      if (living.length > 0) {
        for (const k of living) if (!managed.descendants.includes(k)) managed.descendants.push(k)
        managed.instance.pid = living[0]
        managed.child = null
        managed.adopted = true // no more child events; liveness via polling
        this.startPidPoll(managed)
        this.writeMetaToFile(managed, `[run] 外壳进程退出，服务由后代进程继续运行（pid=${living[0]}）\n`)
        const id = managed.instance.id
        void (async () => {
          const states = await loadRunStates()
          const s = states.find((x) => x.id === id)
          if (s !== undefined) {
            s.pid = managed.instance.pid
            s.descendants = [...managed.descendants]
            await saveRunStates(states)
          }
        })()
        return
      }
      this.setExited(managed, 'exited', code)
    })()
  }

  /** Poll the instance's process-tree root: on death, promote the shallowest
   *  living descendant (memory snapshot first, then a fresh table scan);
   *  only when nothing in the known tree survives does the run end. */
  private startPidPoll(managed: ManagedProcess): void {
    this.stopPidPoll(managed)
    const id = managed.instance.id
    const finish = (): void => {
      this.setExited(managed, 'exited', null)
      void (async () => {
        const runs = await loadRunStates()
        await saveRunStates(runs.filter((r) => r.id !== id))
      })()
    }
    managed.pidPollTimer = setInterval(() => {
      if (managed.instance.status !== 'running') { this.stopPidPoll(managed); return }
      if (pidAlive(managed.instance.pid)) return
      const inSnap = managed.descendants.find((p) => p !== managed.instance.pid && pidAlive(p))
      if (inSnap !== undefined) {
        managed.instance.pid = inSnap
        this.writeMetaToFile(managed, `[host] 服务树根已切换为存活的后代进程（pid=${inSnap}）\n`)
        return
      }
      // Last resort: fresh process-table scan. Orphaned grandchildren keep
      // their original ParentProcessId on Windows, so a BFS from the dead
      // root still finds them.
      void walkChildren(managed.instance.pid).then((kids) => {
        if (managed.instance.status !== 'running') return
        const living = kids.filter(pidAlive)
        if (living.length > 0) {
          for (const k of living) if (!managed.descendants.includes(k)) managed.descendants.push(k)
          managed.instance.pid = living[0]
          this.writeMetaToFile(managed, `[host] 服务树根已切换为存活的后代进程（pid=${living[0]}）\n`)
          return
        }
        finish()
      })
    }, 2000)
  }

  /** Mark an instance as exited and notify subscribers. Also drops the run
   *  state (the process is gone) but keeps the persisted log file. */
  private setExited(managed: ManagedProcess, status: RunInstance['status'], exitCode: number | null): void {
    if (managed.instance.status !== 'running') return
    managed.instance.status = status
    managed.instance.exitedAt = Date.now()
    managed.instance.exitCode = exitCode

    this.writeMetaToFile(managed, `[run] 进程退出: ${status} exitCode=${exitCode ?? ''}\n`)
    // Drain residual output (the service may have died between tailer
    // ticks) so the live view shows the error before the file closes.
    this.flushTailer(managed)
    this.closeLogFile(managed)

    void (async () => {
      const states = await loadRunStates()
      const next = states.filter((s) => s.id !== managed.instance.id)
      if (next.length !== states.length) await saveRunStates(next)
    })()

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

  /** Close host-side state without killing services (plugin teardown / host
   *  restart): running processes stay alive and keep logging to their files;
   *  run states survive so the next host start adopts them again. */
  dispose(): void {
    for (const managed of this.processes.values()) {
      if (managed.exitTimer !== null) clearTimeout(managed.exitTimer)
      this.flushTailer(managed)
      this.stopTailer(managed)
      this.stopPidPoll(managed)
      try {
        if (managed.logFd !== null) {
          closeSync(managed.logFd)
          managed.logFd = null
        }
      } catch { /* already closed */ }
    }
    this.processes.clear()
  }

  /** Adopt orphaned runs persisted by a previous host session: a live pid
   *  means the service survived the restart — re-attach it (file-tailed
   *  logs, working stop), so the UI keeps showing and managing it. */
  async adoptOrphans(): Promise<number> {
    const states = await loadRunStates()
    let adopted = 0
    const stillAlive: RunState[] = []
    for (const s of states) {
      if (this.processes.has(s.id)) continue
      // The recorded pid is the shell wrapper and may have exited while the
      // actual service (a descendant) keeps running. Promote the shallowest
      // living descendant to be the kill root in that case.
      let liveRoot = s.pid
      if (!pidAlive(liveRoot)) {
        const candidates = [...(s.descendants ?? [])].filter(pidAlive)
        if (candidates.length === 0) continue
        liveRoot = candidates[0] // snapshot order: shallowest first
      }
      const instance: RunInstance = {
        id: s.id,
        configId: s.configId,
        configName: s.configName,
        configType: 'custom',
        command: s.command,
        cwd: s.cwd,
        status: 'running',
        pid: liveRoot,
        startedAt: s.startedAt,
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
        logPath: s.logFile,
        logFd: null,
        logSize: 0,
        tailTimer: null,
        adopted: true,
        pidPollTimer: null,
        descendants: [...(s.descendants ?? [])],
      }
      try {
        // 'a+' so the tailer can read the file back (write-only 'a' = EBADF).
        managed.logFd = openSync(s.logFile, 'a+')
      } catch { managed.logFd = null }
      this.processes.set(s.id, managed)
      this.startTailer(managed)
      this.writeMetaToFile(managed, `[host] dsh 重启后已重新接管该服务（pid=${liveRoot}${liveRoot !== s.pid ? `，原记录 ${s.pid} 已退出` : ''}）\n`)
      // Liveness: adopted processes have no child events — poll the tree.
      this.startPidPoll(managed)
      adopted++
      stillAlive.push(s)
    }
    if (stillAlive.length !== states.length) {
      await saveRunStates(states.filter((s) => stillAlive.some((a) => a.id === s.id)))
    }
    return adopted
  }
}

// ---- Persistent log history (read side) ----

/** One persisted run-log file. */
export interface LogFileInfo {
  /** Absolute path of the .log file. */
  file: string
  /** Display name derived from the file name (config name + run stamp). */
  name: string
  mtime: number
  size: number
}

const LOG_STAMP_RE = /_(\d{14})_[0-9a-f]{8}\.log$/i

/** List persisted log files under a workspace. Primary location is
 *  `<workspace>/logs/` (plain); older runs under `.dsh/logs` are also
 *  listed for backward compatibility. Newest first. */
export async function listLogFiles(workspace: string, cap = 300): Promise<LogFileInfo[]> {
  const files: LogFileInfo[] = []
  const dirs = [
    join(workspace, 'logs'),
    join(workspace, '.dsh', 'logs'),
  ]
  for (const dir of dirs) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.endsWith('.log')) continue
      const full = join(dir, n)
      try {
        const s = await stat(full)
        files.push({ file: full, name: displayLogName(n), mtime: s.mtimeMs, size: s.size })
      } catch { /* skip unreadable */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  return files.slice(0, cap)
}

/** Strip the run stamp from a log file name for display. */
function displayLogName(fileName: string): string {
  return fileName.replace(LOG_STAMP_RE, '')
}
