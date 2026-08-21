/**
 * Send text into the DSH conversation composer draft. Mirrors the internal
 * `appendToDraft` of dsh-better-sidebar (not exported from that package):
 * the shared path behind the explorer's @-reference button / viewer
 * selection popup. The conversation service is resolved lazily through
 * `ctx.get`; a missing service, session scope, or activity scope degrades
 * to a logged no-op — never a crash.
 * @module dsh-better-sidebar-starter/client/conversationDraft
 */

import type { Context } from 'cordis'

/** Minimal structural face of the composer input handle we touch. */
interface DraftInputLike {
  state: { getSnapshot(): { draft?: string } }
  setDraft(draft: string): void
}

/** Minimal structural face of the ui-conversation service (composer). */
interface ConversationLike {
  input: { for(actx: unknown): DraftInputLike | undefined }
}

/** Structural face of the client runtime sessions service. */
interface SessionsLike {
  scope(sessionId: string): unknown
}

/**
 * Append `text` to the session's composer draft (space-separated, like the
 * @-mentions). Returns false — and warns — when the conversation service
 * or the session scope is unavailable.
 */
export function appendToDraft(ctx: Context, sessionId: string, text: string): boolean {
  try {
    const sessions = (ctx as { sessions?: SessionsLike }).sessions
    const actx = sessions?.scope(sessionId)
    if (actx === undefined) return false
    const getService = (ctx as unknown as { get: (name: string) => unknown }).get.bind(ctx)
    const conversation = getService('conversation') as ConversationLike | undefined
    if (conversation === undefined || conversation === null) return false
    const input = conversation.input.for(actx)
    if (input === undefined) return false
    const draft = input.state.getSnapshot().draft ?? ''
    input.setDraft(draft.trim() === '' ? text : `${draft} ${text}`)
    return true
  } catch (error) {
    console.warn('[dsh-better-sidebar-starter] draft insert failed:', error)
    return false
  }
}