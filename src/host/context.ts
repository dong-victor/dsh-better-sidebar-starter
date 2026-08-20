/**
 * Structural faces of the host services this plugin consumes. The plugin
 * resolves outside the DSH monorepo's single cordis instance, so the upstream
 * `declare module '@deepseek-ai/cordis'` augmentations do not reliably reach
 * this Context — the members below mirror the actual runtime shapes (the same
 * approach dsh-better-sidebar takes in its own context-types.ts). The real
 * `ctx` passed by the loader satisfies these structurally.
 * @module dsh-better-sidebar-starter/host/context
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

/** A published session's header slice (authoritative cwd). */
export interface PluginSessionHeader {
  cwd?: string
}

/** The host session store face (`ctx.sessions.get(id)`). */
export interface PluginSessionStore {
  get(id: string): { header: PluginSessionHeader } | undefined
}

/** The web runtime face (`ctx.webRuntime.trustedHosts` — the /api gateway's trust source). */
export interface PluginWebRuntime {
  trustedHosts: readonly string[]
}

/** One named webserver route (mirror of @deepseek-ai/dsh-host-webserver WebRoute). */
export interface PluginWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration (mirror of WebUpgradeRoute). */
export interface PluginWebUpgradeRoute {
  path: string
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** The webserver service face (`ctx.webServer.register` / `registerUpgrade`). */
export interface PluginWebServer {
  register(route: PluginWebRoute): () => void
  registerUpgrade(route: PluginWebUpgradeRoute): () => void
}

/** The host context face this plugin's host half reads. */
export interface PluginContext {
  webServer: PluginWebServer
  sessions: PluginSessionStore
  webRuntime: PluginWebRuntime
  /** Register a lifecycle callback (DSH-vendored cordis): runs at plugin
   *  activation; its returned cleanup runs at disposal. */
  effect(fn: () => void | (() => void), label?: string): void
}
