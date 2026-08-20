/**
 * Path picker: a read-only input + browse button that opens a folder tree
 * modal (DirChooser). Shared by the settings panel and the config editor.
 * @module dsh-better-sidebar-starter/client/PathPicker
 */

import { createElement, type ReactNode } from 'react'
import type { SessionScope } from 'dsh-better-sidebar/client/service'
import { DirChooser } from './DirChooser.tsx'

export type PathKind = 'java' | 'node' | 'python' | 'mvn'

/** Props for the path picker. */
export interface PathPickerProps {
  scope: SessionScope
  kind: PathKind
  value: string
  onChange: (v: string) => void
  /** Compact mode (no label/desc wrapper), used inside the modal. */
  compact?: boolean
  desc?: string
}

/** A folder-browse input with a hosted modal tree chooser. */
export function PathPicker(props: PathPickerProps): ReactNode {
  const { scope, value, onChange, compact, desc } = props
  return createElement(DirChooser, {
    scope,
    value,
    onChange,
    compact,
    placeholder: desc,
  })
}
