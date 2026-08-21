/**
 * The /api/dsh-better-sidebar-starter route family: run-config CRUD,
 * process start/stop, instance listing, and the logs WebSocket stream.
 * Everything is session-scoped — every request carries a sessionId (+ optional
 * client cwd) and a path, and the host gate requires the path to live inside
 * the session's authoritative working directory. All routes pass the same
 * browser-trust fence as the /api gateway (Host-header loopback or
 * trustedHosts) — these endpoints spawn processes and write config files.
 * @module dsh-better-sidebar-starter/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { WebSocketServer, type WebSocket } from 'ws'
import type { PluginContext } from './context.ts'
import { isTrustedApiRequest } from './fence.ts'
import { createSessionGate, sessionCwdOf } from './gate.ts'
import { readConfigs, upsertConfig, deleteConfig, stampLastRun, type RunConfig } from './configStore.ts'
import { ProcessManager, type RunInstance } from './processManager.ts'
import { locateSource } from './sourceLocator.ts'

/** Route family base. */
export const STARTER_API = {
  configs: '/api/dsh-better-sidebar-starter/configs',
  instances: '/api/dsh-better-sidebar-starter/instances',
  run: '/api/dsh-better-sidebar-starter/run',
  stop: '/api/dsh-better-sidebar-starter/stop',
  logsWs: '/api/dsh-better-sidebar-starter/logs',
  detectEnv: '/api/dsh-better-sidebar-starter/detect-env',
  locateSource: '/api/dsh-better-sidebar-starter/locate-source',
}
/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024

/** One noServer WebSocket server for log streams. */
const logsWss = new WebSocketServer({ noServer: true })

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Route family dependencies. */
export interface StarterRoutesDeps {
  ctx: PluginContext
  kernels: ProcessManager
  fence: (req: IncomingMessage) => boolean
}

/**
 * Build every starter route plus the logs WebSocket upgrade.
 * @param deps - ctx, kernels (process manager), fence.
 * @returns routes and the upgrade route.
 */
export function makeRoutes(deps: StarterRoutesDeps): { routes: WebRoute[]; upgrade: WebUpgradeRoute } {
  const { ctx, kernels, fence } = deps

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!fence(req)) {
      writeJson(res, 403, { error: 'forbidden' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method ?? ''}` })
      return false
    }
    return true
  }

  /** Resolve the session cwd (canonicalized through the gate). */
  const resolveCwd = async (url: URL, res: ServerResponse): Promise<string | null> => {
    const sessionId = queryParam(url, 'sessionId')
    if (sessionId === undefined || sessionId === '') {
      writeJson(res, 400, { error: 'sessionId is required' })
      return null
    }
    const cwd = sessionCwdOf(ctx, sessionId, queryParam(url, 'cwd'))
    const verdict = await createSessionGate(ctx, sessionId, queryParam(url, 'cwd'))(cwd)
    if (!verdict.ok) {
      writeJson(res, 400, { error: `workspace gate: ${verdict.error}` })
      return null
    }
    return verdict.canonical
  }

  const routes: WebRoute[] = [
    // --------------------------------------------------------- configs (GET / POST / DELETE)
    {
      kind: 'exact',
      path: STARTER_API.configs,
      handler: async (req, res) => {
        if (!fence(req)) {
          writeJson(res, 403, { error: 'forbidden' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const method = req.method ?? 'GET'

        // --- GET: list configs ---
        if (method === 'GET') {
          const cwd = await resolveCwd(url, res)
          if (cwd === null) return
          const configs = await readConfigs(cwd)
          writeJson(res, 200, { configs })
          return
        }

        // --- POST: upsert config ---
        if (method === 'POST') {
          const cwd = await resolveCwd(url, res)
          if (cwd === null) return
          const body = await readJsonBody(req)
          if (body === undefined || body.config === undefined || typeof body.config !== 'object') {
            writeJson(res, 400, { error: 'invalid JSON body: { config } required' })
            return
          }
          const input = body.config as Record<string, unknown>
          if (typeof input.name !== 'string' || input.name.trim() === '') {
            writeJson(res, 400, { error: 'config.name is required' })
            return
          }
          const config = await upsertConfig(cwd, {
            id: typeof input.id === 'string' ? input.id : undefined,
            name: input.name,
            type: typeof input.type === 'string' ? input.type as RunConfig['type'] : 'custom',
            command: typeof input.command === 'string' ? input.command : '',
            cwd: typeof input.cwd === 'string' ? input.cwd : '.',
            env: typeof input.env === 'object' && input.env !== null
              ? input.env as Record<string, string>
              : {},
            jvmArgs: typeof input.jvmArgs === 'string' ? input.jvmArgs : '',
            args: typeof input.args === 'string' ? input.args : '',
            runtime: typeof input.runtime === 'object' && input.runtime !== null
              ? input.runtime as RunConfig['runtime']
              : undefined,
          })
          writeJson(res, 200, { config })
          return
        }

        // --- DELETE: remove config ---
        if (method === 'DELETE') {
          const cwd = await resolveCwd(url, res)
          if (cwd === null) return
          const id = queryParam(url, 'id')
          if (id === undefined) {
            writeJson(res, 400, { error: 'id is required' })
            return
          }
          const removed = await deleteConfig(cwd, id)
          // Also stop any running instances of this config.
          for (const inst of kernels.listInstances()) {
            if (inst.configId === id && inst.status === 'running') {
              kernels.stop(inst.id)
            }
          }
          writeJson(res, 200, { ok: true, removed })
          return
        }

        writeJson(res, 405, { error: `method not allowed: ${method}` })
      },
    },
    // --------------------------------------------------------- locate-source POST
    // Resolve a logged class name / stack frame to a source file under the
    // session cwd (click-through from the log view).
    {
      kind: 'exact',
      path: STARTER_API.locateSource,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const cwd = await resolveCwd(url, res)
        if (cwd === null) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const className = typeof body.className === 'string' ? body.className : undefined
        const file = typeof body.file === 'string' ? body.file : undefined
        const method = typeof body.method === 'string' ? body.method : undefined
        const line = typeof body.line === 'number' ? body.line : undefined
        const root = typeof body.root === 'string' ? body.root : undefined
        if (className === undefined && file === undefined) {
          writeJson(res, 400, { error: 'className or file is required' })
          return
        }
        const result = await locateSource(cwd, { className, file, method, line, root })
        writeJson(res, 200, result)
      },
    },
    // --------------------------------------------------------- instances GET
    {
      kind: 'exact',
      path: STARTER_API.instances,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = queryParam(url, 'sessionId')
        if (sessionId === undefined || sessionId === '') {
          writeJson(res, 400, { error: 'sessionId is required' })
          return
        }
        // Instances are not session-scoped by cwd — they are keyed by id and
        // the client filters by configId. We return all active instances.
        writeJson(res, 200, { instances: kernels.listInstances() })
      },
    },
    // --------------------------------------------------------- run POST
    {
      kind: 'exact',
      path: STARTER_API.run,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const cwd = await resolveCwd(url, res)
        if (cwd === null) return
        const body = await readJsonBody(req)
        if (body === undefined || typeof body.configId !== 'string') {
          writeJson(res, 400, { error: 'invalid JSON body: { configId } required' })
          return
        }
        const configs = await readConfigs(cwd)
        const config = configs.find((c) => c.id === body.configId)
        if (config === undefined) {
          writeJson(res, 404, { error: 'config not found' })
          return
        }
        // Resolve the config's working directory.
        // config.cwd may be '.' (root), a relative path, or an absolute path
        // (from the directory tree picker which returns absolute paths).
        const { isAbsolute, resolve } = await import('node:path')
        const configCwd = config.cwd === '.' || config.cwd === ''
          ? cwd
          : isAbsolute(config.cwd)
            ? config.cwd
            : resolve(cwd, config.cwd)
        const gate = createSessionGate(ctx, queryParam(url, 'sessionId') ?? '', queryParam(url, 'cwd'))
        const verdict = await gate(configCwd)
        if (!verdict.ok) {
          writeJson(res, 400, { error: `config cwd gate: ${verdict.error}` })
          return
        }
        await stampLastRun(cwd, config.id)
        const globalEnv = typeof body.globalEnv === 'object' && body.globalEnv !== null
          ? body.globalEnv as Record<string, string>
          : {}
        const instance = kernels.spawnConfig(config, verdict.canonical, globalEnv)
        writeJson(res, 200, { instance })
      },
    },
    // --------------------------------------------------------- stop POST
    {
      kind: 'exact',
      path: STARTER_API.stop,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined || typeof body.instanceId !== 'string') {
          writeJson(res, 400, { error: 'invalid JSON body: { instanceId } required' })
          return
        }
        const stopped = kernels.stop(body.instanceId)
        writeJson(res, 200, { ok: true, stopped })
      },
    },
    // --------------------------------------------------- detect-env GET
    {
      kind: 'exact',
      path: STARTER_API.detectEnv,
      handler: async (req, res) => {
        if (!fence(req)) { writeJson(res, 403, { error: 'forbidden' }); return }
        // Detect Java/Node/Python from system env and common paths.
        const { existsSync } = await import('node:fs')
        const { join } = await import('node:path')
        const { execFileSync } = await import('node:child_process')
        const isWin = process.platform === 'win32'

        const result: { javaHome?: string; nodePath?: string; pythonPath?: string; mvnPath?: string; home?: string; _diagSystemRoot?: string; _diagPathHasSystem32?: boolean } = {}
        result.home = process.env.USERPROFILE ?? process.env.HOME ?? ''
        result._diagSystemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? '(none)'
        result._diagPathHasSystem32 = (process.env.PATH ?? '').toLowerCase().includes('system32')

        // Java: check JAVA_HOME, then scan .jdks
        if (process.env.JAVA_HOME && process.env.JAVA_HOME.trim() !== '') {
          const home = process.env.JAVA_HOME.trim()
          if (existsSync(join(home, 'bin', isWin ? 'java.exe' : 'java'))) {
            result.javaHome = home
          }
        }
        if (result.javaHome === undefined) {
          const userHome = process.env.USERPROFILE ?? process.env.HOME ?? ''
          // Candidate roots containing JDK-install dirs, per platform.
          const scanRoots = isWin
            ? [join(userHome, '.jdks')]
            : [
                // macOS: Homebrew + Xcode / manual installs
                '/Library/Java/JavaVirtualMachines',
                join(userHome, 'Library/Java/JavaVirtualMachines'),
                '/opt/homebrew/opt',
                // Linux: standard JVM roots
                '/usr/lib/jvm',
                '/usr/java',
              ]
          const listDirs = (base: string): string[] => {
            if (!existsSync(base)) return []
            if (isWin) {
              return execFileSync('cmd', ['/c', 'dir', '/b', '/ad', base], {
                encoding: 'utf8', timeout: 3000, windowsHide: true,
              }).split('\n').map((s: string) => s.trim()).filter((s: string) => s !== '')
            }
            // POSIX: readdir via fs is unavailable here; use `ls -1 -p` and strip trailing '/'.
            const out = execFileSync('ls', ['-1', '-p', base], {
              encoding: 'utf8', timeout: 3000,
            })
            return out.split('\n').map((s: string) => s.trim().replace(/\/$/, '')).filter((s: string) => s !== '')
          }
          for (const base of scanRoots) {
            try {
              const dirs = listDirs(base)
              let best: string | null = null
              let bestScore = -1
              for (const d of dirs) {
                const home = join(base, d)
                if (existsSync(join(home, 'bin', isWin ? 'java.exe' : 'java'))) {
                  const verMatch = d.match(/(\d+)(?:\.|$)/)
                  const ver = verMatch ? parseInt(verMatch[1], 10) : 0
                  const isRealJdk = /jdk|corretto|temurin|zulu|liberica/i.test(d)
                  const score = ver + (isRealJdk ? 1000 : 0)
                  if (score > bestScore) { bestScore = score; best = home }
                }
              }
              if (best !== null) { result.javaHome = best; break }
            } catch { /* dir failed — try next */ }
          }
        }

        // Node: check NODE_PATH, then `which node`
        if (process.env.NODE_PATH && process.env.NODE_PATH.trim() !== '') {
          result.nodePath = process.env.NODE_PATH.trim()
        } else {
          try {
            const nodeBin = execFileSync(isWin ? 'where' : 'which',
              isWin ? ['node.exe'] : ['node'],
              { encoding: 'utf8', timeout: 3000, windowsHide: true }
            ).split('\n')[0]?.trim()
            if (nodeBin) {
              // node.exe in C:\...\nodejs\node.exe → C:\...\nodejs
              const lastSep = Math.max(nodeBin.lastIndexOf('/'), nodeBin.lastIndexOf('\\'))
              const dir = lastSep >= 0 ? nodeBin.substring(0, lastSep) : nodeBin
              result.nodePath = dir
            }
          } catch { /* not found */ }
        }

        // Python: check PYTHON_PATH, then `which python`
        if (process.env.PYTHON_PATH && process.env.PYTHON_PATH.trim() !== '') {
          result.pythonPath = process.env.PYTHON_PATH.trim()
        } else {
          try {
            const pyBin = execFileSync(isWin ? 'where' : 'which',
              isWin ? ['python.exe'] : ['python3'],
              { encoding: 'utf8', timeout: 3000, windowsHide: true }
            ).split('\n')[0]?.trim()
            if (pyBin) {
              const lastSep = Math.max(pyBin.lastIndexOf('/'), pyBin.lastIndexOf('\\'))
              const dir = lastSep >= 0 ? pyBin.substring(0, lastSep) : pyBin
              result.pythonPath = dir
            }
          } catch { /* not found */ }
        }

        // Maven: check MAVEN_HOME / MVN_PATH, then `where mvn`
        if (process.env.MAVEN_HOME && process.env.MAVEN_HOME.trim() !== '') {
          result.mvnPath = process.env.MAVEN_HOME.trim()
        } else if (process.env.MVN_PATH && process.env.MVN_PATH.trim() !== '') {
          result.mvnPath = process.env.MVN_PATH.trim()
        } else {
          try {
            const mvnBin = execFileSync(isWin ? 'where' : 'which',
              isWin ? ['mvn.cmd'] : ['mvn'],
              { encoding: 'utf8', timeout: 3000, windowsHide: true }
            ).split('\n')[0]?.trim()
            if (mvnBin) {
              // mvn.cmd in ...\apache-maven-x\bin\mvn.cmd → ...\apache-maven-x\bin
              const lastSep = Math.max(mvnBin.lastIndexOf('/'), mvnBin.lastIndexOf('\\'))
              const dir = lastSep >= 0 ? mvnBin.substring(0, lastSep) : mvnBin
              result.mvnPath = dir
            }
          } catch { /* not found */ }
        }

        writeJson(res, 200, result)
      },
    },
  ]

  // ---------------------------------------------- logs stream (upgrade)
  const upgrade: WebUpgradeRoute = {
    path: STARTER_API.logsWs,
    handler: (req, socket, head) => {
      if (!fence(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const instanceId = queryParam(url, 'instanceId')
      if (instanceId === undefined || instanceId === '') {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const instance = kernels.getInstance(instanceId)
      if (instance === undefined) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      logsWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        // Replay buffered logs.
        const logs = kernels.getLogs(instanceId)
        ws.send(JSON.stringify({ type: 'history', entries: logs }))
        // Send current status.
        ws.send(JSON.stringify({
          type: 'status',
          status: instance.status,
          exitCode: instance.exitCode,
        }))
        // Attach to future logs.
        kernels.attach(instanceId, ws)
      })
    },
  }

  return { routes, upgrade }
}
