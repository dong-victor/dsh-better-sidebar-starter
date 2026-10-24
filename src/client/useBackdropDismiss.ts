/**
 * Overlay backdrop dismissal that respects text selection.
 *
 * Why this exists: the previous `onClick: (e) => { if (e.target === e.currentTarget) onCancel() }`
 * closed the dialog while the user was drag-selecting text in it. The `click`
 * event is dispatched on the nearest COMMON ANCESTOR of the mousedown and
 * mouseup targets, so starting a selection inside a field and releasing the
 * button past the dialog edge makes `target === currentTarget` true on the
 * overlay even though the user never meant to dismiss anything.
 *
 * The fix: the gesture must both START and END on the overlay itself.
 *
 * @module dsh-better-sidebar-starter/client/useBackdropDismiss
 */

import { useRef, type MouseEvent } from 'react'

/** Which part of the overlay a gesture started / ended on. */
export interface BackdropGesture {
  /** The mousedown landed on the overlay itself (not inside the dialog). */
  downOnBackdrop: boolean
  /** The mouseup landed on the overlay itself. */
  upOnBackdrop: boolean
}

/**
 * Decide whether a `click` on the overlay should dismiss the dialog.
 *
 * Pure and total, so it can be unit-tested without a DOM: the only inputs are
 * where the press started, where it ended, and the click target.
 *
 * @param gesture Gesture state captured from the preceding mousedown/mouseup.
 * @param clickTargetIsBackdrop Whether `click.target === click.currentTarget`.
 */
export function shouldDismissFromBackdrop(
  gesture: BackdropGesture,
  clickTargetIsBackdrop: boolean,
): boolean {
  // Both ends must be the backdrop. A press that started inside the dialog
  // (e.g. the beginning of a text selection) never dismisses, no matter where
  // the browser decided to dispatch the resulting click.
  if (!gesture.downOnBackdrop) return false
  if (!gesture.upOnBackdrop) return false
  return clickTargetIsBackdrop
}

export interface BackdropDismissHandlers {
  onMouseDown: (e: MouseEvent) => void
  onClick: (e: MouseEvent) => void
  onMouseUp: (e: MouseEvent) => void
}

/**
 * @param onDismiss Called only for a genuine backdrop press-and-release.
 * @returns Handlers to spread onto the overlay element.
 */
export function useBackdropDismiss(onDismiss: () => void): BackdropDismissHandlers {
  const gesture = useRef<BackdropGesture>({ downOnBackdrop: false, upOnBackdrop: false })

  return {
    onMouseDown: (e: MouseEvent) => {
      // Reset both ends: a stale `upOnBackdrop` from a gesture that ended
      // outside this element must never combine with a new press.
      gesture.current = { downOnBackdrop: e.target === e.currentTarget, upOnBackdrop: false }
    },
    onMouseUp: (e: MouseEvent) => {
      gesture.current.upOnBackdrop = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent) => {
      const dismiss = shouldDismissFromBackdrop(gesture.current, e.target === e.currentTarget)
      gesture.current = { downOnBackdrop: false, upOnBackdrop: false }
      if (dismiss) onDismiss()
    },
  }
}
