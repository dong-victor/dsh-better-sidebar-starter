/**
 * Shared utility functions for the starter plugin.
 * @module dsh-better-sidebar-starter/client/utils
 */

/**
 * Absolute WebSocket URL for one of this plugin's own host routes.
 *
 * A RELATIVE URL cannot be handed to `new WebSocket`: the constructor resolves
 * it against the page origin, and the desktop shell serves the GUI from the
 * custom scheme `dsh-app://app/`, so the result carries the scheme `dsh-app`
 * and the browser rejects it outright ("The URL's scheme must be either
 * 'http', 'https', 'ws' or 'wss'"). The shell publishes the Host's real origin
 * through `__DSH_TRANSPORT__.streamBaseUrl`, which is the same source DSH's own
 * downlink mux resolves through (`@deepseek-ai/dsh-api-gateway`'s
 * `stream-client`), so prefer it and fall back to `document.baseURI` for
 * ordinary http(s) pages — that base also carries a reverse-proxy prefix.
 *
 * Only the WebSocket transport needs this: `fetch` keeps using page-relative
 * paths, because the shell's `protocol.handle` forwards non-static
 * `dsh-app://app/...` requests to the Host same-origin, whereas a cross-origin
 * `fetch` would be blocked by CORS.
 * @param path - Host route with a leading slash (`/api/dsh-better-sidebar-starter/logs`).
 * @returns Absolute `ws:`/`wss:` URL.
 */
export function hostWebSocketUrl(path: string): string {
  const injected = (globalThis as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } })
    .__DSH_TRANSPORT__?.streamBaseUrl
  const base = injected !== undefined && injected !== ''
    ? injected
    : (typeof document !== 'undefined' ? document.baseURI : undefined)
  // Resolve against the directory base so the page's own directory prefix is
  // preserved rather than replaced, then swap in the ws scheme.
  const url = new URL(path.replace(/^\/+/, ''), ensureDirectoryBase(base))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

/** Force a trailing slash so relative resolution appends instead of replacing
 *  the base's last segment. Falls back to a placeholder origin when the page
 *  exposes no usable base (non-DOM specs); the caller still gets a valid URL. */
function ensureDirectoryBase(base: string | undefined): string {
  const url = new URL(base !== undefined && base !== '' ? base : 'http://dsh.internal/', 'http://dsh.internal/')
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

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