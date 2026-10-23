/**
 * Host half of the dsh-better-sidebar-starter plugin: mounts the
 * session-scoped starter routes (/api/dsh-better-sidebar-starter/*) and the
 * logs WebSocket upgrade, owning one ProcessManager that spawns child
 * processes for run configurations and streams their stdout/stderr to
 * browsers.
 * @module dsh-better-sidebar-starter
 */

import type { IncomingMessage } from 'node:http'
import type { PluginConnection, PluginContext } from './host/context.ts'
import { ProcessManager } from './host/processManager.ts'
import { isTrustedApiRequest } from './host/fence.ts'
import { makeRoutes } from './host/routes.ts'
import { registerAgentTools } from './host/agentTools.ts'

/** Plugin identity for cordis.yml rows / the bundle patch. */
export const name = 'dsh-better-sidebar-starter'

/** Services required before mounting: the webserver routes, the session
 *  store (authoritative cwd for the path gate), and — for the chat-side
 *  service tools — the agent tool registry and the system-prompt service.
 *
 *  Deliberately NOT injected here:
 *  - `webRuntime` — provided by dsh 0.2.0-rc.2, REMOVED in 0.2.1-rc.2. An
 *    unmet injection keeps a cordis plugin inactive, so requiring it made the
 *    whole host half vanish on 0.2.1: no /api/dsh-better-sidebar-starter/*
 *    routes (the panel's `fs-dirs .: 404`) and no client mount (no CSS).
 *  - `connection` — the /api gateway's trust source. Read lazily through
 *    `ctx.get()` so a composition that renames or drops it degrades the fence
 *    instead of disabling the plugin. */
export const inject = ['webServer', 'sessions', 'tools', 'systemPrompt']

/** Plugin body: mount the fenced starter routes and the process lifecycle. */
export function apply(ctx: PluginContext): void {
  // Fence with the same Host/Origin authority list the /api gateway enforces.
  // `connection` is resolved lazily (it is not injected), so an absent service
  // falls back to loopback-only instead of throwing "without inject".
  const fence = (req: IncomingMessage): boolean => {
    const connection = ctx.get?.('connection') as PluginConnection | undefined
    if (Array.isArray(connection?.trustedHosts)) {
      return isTrustedApiRequest(req, connection.trustedHosts)
    }
    if (typeof connection?.requestRejection === 'function') {
      return connection.requestRejection(req) === undefined
    }
    // No gateway to ask: accept loopback only.
    return isTrustedApiRequest(req, [])
  }
  const kernels = new ProcessManager()

  // Re-attach services survived a previous host session (their pids are
  // still alive) so the panel keeps showing and managing them, and their
  // file-backed logs stay readable after the restart.
  void kernels.adoptOrphans().then((count) => {
    if (count > 0) console.log(`[starter] 已接管 ${count} 个跨重启存活的运行服务`)
  })

  ctx.effect(() => {
    const { routes, upgrade } = makeRoutes({ ctx, kernels, fence })
    const disposers = routes.map(route => ctx.webServer.register(route))
    disposers.push(ctx.webServer.registerUpgrade(upgrade))
    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* already disposed */ }
      }
    }
  }, 'dsh-better-sidebar-starter: routes')

  ctx.effect(() => {
    const disposeTools = registerAgentTools(ctx, kernels)
    return () => {
      try { disposeTools() } catch { /* already disposed */ }
    }
  }, 'dsh-better-sidebar-starter: agent tools')

  ctx.effect(() => () => {
    kernels.dispose()
  }, 'dsh-better-sidebar-starter: teardown')
}
