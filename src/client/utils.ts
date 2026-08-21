/**
 * Shared utility functions for the starter plugin.
 * @module dsh-better-sidebar-starter/client/utils
 */

let toastEl: HTMLDivElement | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

/** Show a small floating toast notification. */
export function showToast(message: string, success: boolean): void {
  // Dismiss previous toast.
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
  if (toastEl !== null) {
    document.body.removeChild(toastEl)
    toastEl = null
  }

  const el = document.createElement('div')
  el.textContent = message
  el.style.cssText = `
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    background: ${success ? 'rgba(78,154,6,0.9)' : 'rgba(235,87,87,0.9)'};
    color: #fff;
    font-size: 12px;
    border-radius: 6px;
    z-index: 999999;
    box-shadow: 0 2px 12px rgba(0,0,0,0.4);
    pointer-events: none;
    font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", "Cascadia Code", Menlo, Consolas, monospace;
  `
  document.body.appendChild(el)
  toastEl = el
  toastTimer = setTimeout(() => {
    if (toastEl !== null) {
      document.body.removeChild(toastEl)
      toastEl = null
    }
    toastTimer = null
  }, 2000)
}

/** Copy text to clipboard with fallback for sandboxed iframes. Shows toast feedback. */
export function copyToClipboard(text: string): boolean {
  try {
    // Try modern clipboard API.
    if (navigator.clipboard && (window as any).clipboardEvent !== undefined) {
      void navigator.clipboard.writeText(text)
      showToast('已复制到剪贴板', true)
      return true
    }
  } catch { /* fallback below */ }

  // Fallback: create textarea, select, execCommand.
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '0'
    ta.style.opacity = '0'
    ta.style.width = '1px'
    ta.style.height = '1px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (ok) {
      showToast('已复制到剪贴板', true)
      return true
    }
  } catch { /* last resort below */ }

  // Last resort.
  try {
    void navigator.clipboard?.writeText(text)
    showToast('已复制到剪贴板', true)
    return true
  } catch {
    showToast('复制失败', false)
    return false
  }
}