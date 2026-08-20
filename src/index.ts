/**
 * Host half of the dsh-better-sidebar-starter plugin: mounts the
 * session-scoped starter routes (/api/dsh-better-sidebar-starter/*) and the
 * logs WebSocket upgrade, owning one ProcessManager that spawns child
 * processes for run configurations and streams their stdout/stderr to
 * browsers.
 * @module dsh-better-sidebar-starter
 */

import type { IncomingMessage } from 'node:http'
import type { PluginContext } from './host/context.ts'
import { ProcessManager } from './host/processManager.ts'
import { isTrustedApiRequest } from './host/fence.ts'
import { makeRoutes } from './host/routes.ts'

/** Plugin identity for cordis.yml rows / the bundle patch. */
export const name = 'dsh-better-sidebar-starter'

/** Services required before mounting: the webserver routes, the session
 *  store (authoritative cwd for the path gate), and the web runtime's
 *  trusted hosts (the /api gateway's trust source). */
export const inject = ['webServer', 'sessions', 'webRuntime']

/** Plugin body: mount the fenced starter routes and the process lifecycle. */
export function apply(ctx: PluginContext): void {
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)
  const kernels = new ProcessManager()

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

  ctx.effect(() => () => {
    kernels.dispose()
  }, 'dsh-better-sidebar-starter: teardown')
}
