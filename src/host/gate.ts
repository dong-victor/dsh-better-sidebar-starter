/**
 * Session-scoped path gate for the starter plugin routes. Every config/instance
 * request carries a sessionId (+ optional client cwd) and a path; this gate
 * resolves the session's AUTHORITATIVE working directory from the session
 * store (the same source dsh-better-sidebar uses) and requires the
 * (canonicalized) target to live inside it — a path outside the
 * conversation's cwd is refused, exactly like the sidebar's own fs routes.
 * @module dsh-better-sidebar-starter/host/gate
 */

import { realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { PluginContext } from './context.ts'

export type GateVerdict = { ok: true; canonical: string } | { ok: false; error: string }
export type WorkspaceGate = (path: string) => Promise<GateVerdict>

/** Case-insensitive (on win32) containment check with both separators normalized. */
export function isPathInside(root: string, child: string): boolean {
  if (root === '' || child === '') return false
  const norm = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '')
  const normRoot = norm(root)
  const normChild = norm(child)
  if (process.platform === 'win32') {
    const a = normRoot.toLowerCase()
    const b = normChild.toLowerCase()
    if (b === a) return true
    return b.startsWith(`${a}/`)
  }
  if (normChild === normRoot) return true
  return normChild.startsWith(`${normRoot}/`)
}

/** The session's authoritative working directory (header cwd wins, then the
 *  client-provided cwd, then the process cwd — never throws for a blank one). */
export function sessionCwdOf(ctx: PluginContext, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '') return clientCwd
  return process.cwd()
}

/**
 * Build a gate bound to one session scope. The requested path may be
 * absolute (the common case — the sidebar passes absolute paths) or
 * relative to the session cwd; the canonicalized result is required to be
 * inside the (canonicalized) session cwd.
 */
export function createSessionGate(ctx: PluginContext, sessionId: string, clientCwd?: string): WorkspaceGate {
  return async (raw) => {
    if (typeof raw !== 'string' || raw === '') return { ok: false, error: 'empty path' }
    const cwd = sessionCwdOf(ctx, sessionId, clientCwd)
    let target = isAbsolute(raw) ? raw : join(cwd, raw)
    let canonicalCwd: string
    try {
      target = await realpath(target)
      canonicalCwd = await realpath(cwd)
    } catch {
      return { ok: false, error: 'path does not resolve on disk' }
    }
    if (!isPathInside(canonicalCwd, target)) {
      return { ok: false, error: 'path is outside the session working directory' }
    }
    return { ok: true, canonical: target }
  }
}
