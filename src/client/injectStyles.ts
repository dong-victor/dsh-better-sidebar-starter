/**
 * Stylesheet injection for the starter plugin's UI. Kept in its own module so
 * both entry points can install it: the plugin `apply()` (so the gear-popup
 * settings panel is styled the moment the plugin loads) and `ServicesTab`
 * (defensive, in case the panel is mounted through another path).
 * @module dsh-better-sidebar-starter/client/injectStyles
 */

import { STYLES_CSS } from './styles.ts'

/** The `<style>` element id — also the "already installed" sentinel. */
const STYLE_TAG_ID = 'dsh-better-sidebar-starter-styles'

/**
 * Append the plugin stylesheet to `document.head` once.
 *
 * The settings panel renders inside better-sidebar's gear popup, which mounts
 * independently of the "服务" tab. Injecting only from `ServicesTab` therefore
 * left the panel unstyled whenever the tab had not been opened yet — so the
 * plugin calls this as soon as its client half applies.
 */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_TAG_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_TAG_ID
  tag.setAttribute('data-plugin', '@dong-victor/dsh-better-sidebar-starter')
  tag.textContent = STYLES_CSS
  ;(document.head ?? document.documentElement).appendChild(tag)
}
