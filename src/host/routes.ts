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

/** Route family base. */
export const STARTER_API = {
  configs: '/api/dsh-better-sidebar-starter/configs',
  instances: '/api/dsh-better-sidebar-starter/instances',
  run: '/api/dsh-better-sidebar-starter/run',
  stop: '/api/dsh-better-sidebar-starter/stop',
  logsWs: '/api/dsh-better-sidebar-starter/logs',
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
        // Resolve the config's working directory (relative to session cwd).
        const gate = createSessionGate(ctx, queryParam(url, 'sessionId') ?? '', queryParam(url, 'cwd'))
        const configCwd = config.cwd === '.' ? cwd : `${cwd}/${config.cwd}`
        const verdict = await gate(configCwd)
        if (!verdict.ok) {
          writeJson(res, 400, { error: `config cwd gate: ${verdict.error}` })
          return
        }
        await stampLastRun(cwd, config.id)
        const instance = kernels.spawnConfig(config, verdict.canonical)
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
