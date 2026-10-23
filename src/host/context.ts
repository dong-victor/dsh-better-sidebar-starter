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

/**
 * The connection face (`ctx.connection` — the /api gateway's owner, provided
 * by `@deepseek-ai/dsh-client-connection`). It is this plugin's trust source:
 * `trustedHosts` is the deployment authority list and `requestRejection` is
 * the gateway's own Host/Origin fence plus browser authentication. Both
 * members exist on dsh 0.2.0-rc.2 and 0.2.1-rc.2 — unlike `webRuntime`, which
 * 0.2.1 removed, so this face keeps the plugin mounting on both runtimes.
 */
export interface PluginConnection {
  /** Non-loopback authorities this deployment serves (may be absent). */
  trustedHosts?: readonly string[]
  /** The gateway's own fence: 403/401 when refused, undefined when admitted. */
  requestRejection?(req: IncomingMessage): number | undefined
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

/**
 * Structural face of `@deepseek-ai/dsh-tools` tool definitions. The host only
 * reads these properties (schema + execute + render), so a plain object
 * literal satisfies it — same approach dsh-mcphub takes for its bridged
 * tools — and the plugin needs no runtime dependency on dsh-tools.
 */
export interface PluginToolDefinition {
  name: string
  description: string
  /** Full JSON Schema for the tool arguments (object root). */
  parameters: Record<string, unknown>
  output: {
    /** JSON Schema for the canonical return value. */
    schema: Record<string, unknown>
    /** Pure projection from args + value to model-facing content blocks. */
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  execute(args: Record<string, unknown>, exec?: { signal?: AbortSignal }): Promise<unknown>
}

/** The cordis `tools` service face: register returns a disposer. */
export interface PluginToolRuntime {
  register(def: PluginToolDefinition): () => void
}

/** One system-prompt section registration (returns a disposer). */
export interface PluginSystemPrompt {
  section(opts: { name: string; order: number; text: () => string }): () => void
}

/** The host context face this plugin's host half reads. */
export interface PluginContext {
  webServer: PluginWebServer
  sessions: PluginSessionStore
  /** Register a lifecycle callback (DSH-vendored cordis): runs at plugin
   *  activation; its returned cleanup runs at disposal. */
  effect(fn: () => void | (() => void), label?: string): void
  /** The /api gateway (`@deepseek-ai/dsh-client-connection`), i.e. this
   *  plugin's trust source. NOT listed in `inject`: it is resolved lazily
   *  through `ctx.get`, so a composition that renames or drops the service
   *  loses only the gateway-based fence, never the plugin. */
  connection?: PluginConnection
  /** cordis' non-throwing service lookup — returns undefined instead of
   *  throwing for a service this plugin does not inject. */
  get?(name: string): unknown
  /** Structural `tools` service (may be absent on very old hosts). */
  tools?: PluginToolRuntime
  /** Structural system-prompt service (may be absent on very old hosts). */
  systemPrompt?: PluginSystemPrompt
}
