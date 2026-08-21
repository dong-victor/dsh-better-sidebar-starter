/**
 * SVG icons for the starter plugin. Each icon is a React component that
 * takes a size prop and renders an inline SVG. Monochrome, currentColor fill.
 * @module dsh-better-sidebar-starter/client/icons
 */

import { createElement, type ReactNode } from 'react'

interface IconProps {
  size: number
}

function svg(size: number, pathChildren: string): ReactNode {
  const svgHtml = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${pathChildren}</svg>`
  return createElement('span', {
    style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size },
    dangerouslySetInnerHTML: { __html: svgHtml },
  })
}

/** 🚀 Rocket — the tab icon. */
export function RocketIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M9.19 8.35c.34-.05.67-.1 1-.13 1.2-1.49 2.85-2.49 4.85-3.02 2-.53 4.16-.42 6.5.33.75 2.34.86 4.5.33 6.5-.53 2-1.53 3.65-3.02 4.85-.04.33-.08.66-.13 1-.13.87-.32 1.71-.57 2.5-.42 1.3-1.02 2.5-1.78 3.6-.42.6-1.1.96-1.86.96-.72 0-1.4-.34-1.84-.93l-2.06-2.76c-.2-.27-.5-.43-.82-.43H7.68c-.32 0-.62-.16-.82-.43l-2.06-2.76C4.36 19.34 4 18.66 4 17.94c0-.76.36-1.44.96-1.86 1.1-.76 2.3-1.36 3.6-1.78.79-.25 1.63-.44 2.5-.57l.13-1c.05-.34.1-.67.13-1z" fill="currentColor" opacity="0.85"/><circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" opacity="0.6"/><path d="M5 14c-1 0-2 .5-2 2 0 1 .5 2 .5 2s1-.5 1.5-.5 1.5.5 1.5.5 1-.5 1-2-.5-2-2-2z" fill="currentColor" opacity="0.5"/>`)
}

/** ▶ Play — start button. */
export function PlayIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M8 5v14l11-7z" fill="currentColor"/>`)
}

/** ⏹ Stop — stop button. */
export function StopIcon({ size }: IconProps): ReactNode {
  return svg(size, `<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>`)
}

/** 🔄 Restart — restart button. */
export function RestartIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M12 5V2L7 7l5 5V8c2.76 0 5 2.24 5 5s-2.24 5-5 5-5-2.24-5-5H5c0 3.87 3.13 7 7 7s7-3.13 7-7-3.13-7-7-7z" fill="currentColor"/>`)
}

/** ⚙ Gear — edit button. */
export function GearIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3l-1.97-.39c-.11-.37-.26-.72-.44-1.06l1.14-1.64c.26-.37.22-.88-.09-1.2l-1.28-1.28c-.32-.31-.83-.35-1.2-.09l-1.64 1.14c-.34-.18-.69-.33-1.06-.44L14.94 4c-.1-.42-.47-.72-.9-.72h-1.8c-.43 0-.8.3-.9.72l-.39 1.97c-.37.11-.72.26-1.06.44L7.25 5.27c-.37-.26-.88-.22-1.2.09L4.77 6.64c-.31.32-.35.83-.09 1.2l1.14 1.64c-.18.34-.33.69-.44 1.06L3.4 11c-.42.1-.72.47-.72.9v1.8c0 .43.3.8.72.9l1.97.39c.11.37.26.72.44 1.06l-1.14 1.64c-.26.37-.22.88.09 1.2l1.28 1.28c.32.31.83.35 1.2.09l1.64-1.14c.34.18.69.33 1.06.44l.39 1.97c.1.42.47.72.9.72h1.8c.43 0 .8-.3.9-.72l.39-1.97c.37-.11.72-.26 1.06-.44l1.64 1.14c.37.26.88.22 1.2-.09l1.28-1.28c.31-.32.35-.83.09-1.2l-1.14-1.64c.18-.34.33-.69.44-1.06L20.6 14c.42-.1.72-.47.72-.9v-1.8c0-.43-.3-.8-.72-.9z" fill="currentColor"/>`)
}

/** 🗑 Trash — delete button. */
export function TrashIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>`)
}

/** ➕ Plus — add new config. */
export function PlusIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>`)
}

/** ✕ Close — modal cancel. */
export function CloseIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>`)
}

/** ▾ Chevron down — tree expand. */
export function ChevronDownIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M7 10l5 5 5-5z" fill="currentColor"/>`)
}

/** ▸ Chevron right — tree collapse. */
export function ChevronRightIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M10 7l5 5-5 5z" fill="currentColor"/>`)
}

/** 🟢 Dot — running status. */
export function RunningDotIcon({ size }: IconProps): ReactNode {
  return svg(size, `<circle cx="12" cy="12" r="5" fill="#4e9a06"/>`)
}

/** ✅ Check — completed status. */
export function CheckIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="#4e9a06"/>`)
}

/** 🔴 Error dot — failed status. */
export function ErrorDotIcon({ size }: IconProps): ReactNode {
  return svg(size, `<circle cx="12" cy="12" r="5" fill="#cc0000"/>`)
}

/** 📋 Log — download log. */
export function DownloadIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>`)
}

/** 📦 npm package icon. */
export function NpmIcon({ size }: IconProps): ReactNode {
  return svg(size, `<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 17V8h4v6h2V8h4v9h-4v-3h-2v3H7z" fill="currentColor"/>`)
}

/** ☕ springboot icon. */
export function SpringIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M12 2C7.5 2 4 5.5 4 10c0 3 2 5.5 4.5 7 .5-2 1.5-3.5 3-4.5 1.5 1 2.5 2.5 3 4.5 2.5-1.5 4.5-4 4.5-7 0-4.5-3.5-8-7-8z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 10c1-1 2.5-1.5 4-1.5s3 .5 4 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`)
}

/** 🐍 python icon. */
export function PythonIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M12 4c-2 0-4 1-4 3v2h4v1H6c-1 0-2 1-2 3s1 3 2 3h2v-2c0-2 2-3 4-3h2c1 0 2-1 2-2V7c0-2-2-3-4-3z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10.5" cy="6.5" r="0.8" fill="currentColor"/><path d="M12 20c2 0 4-1 4-3v-2h-4v-1h4c1 0 2-1 2-3s-1-3-2-3h-2v2c0 2-2 3-4 3h-2c-1 0-2 1-2 2v3c0 2 2 3 4 3z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="13.5" cy="17.5" r="0.8" fill="currentColor"/>`)
}

/** ⚡ custom icon. */
export function CustomIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M11 21h-1l1-7H7.5c-.6 0-.8-.4-.5-.9 1.5-2.6 3.7-6.2 6.5-10.1h1l-1 7h3.5c.6 0 .8.4.5.9C14.5 14.7 12.3 18.1 11 21z" fill="currentColor"/>`)
}

/** 📁 Folder — directory tree icon. */
export function FolderIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" fill="currentColor" opacity="0.7"/>`)
}

/** 📋 Clipboard — bulk paste env. */
export function ClipboardIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" fill="currentColor"/>`)
}

/** 📄 Copy — duplicate a run config. */
export function CopyIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M21 8c0-1.1-.9-2-2-2h-9c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h9c1.1 0 2-.9 2-2V8z" fill="currentColor"/><path d="M3 16V4c0-1.1.9-2 2-2h10v2H5v12H3z" fill="currentColor" opacity="0.6"/>`)
}

/** ✈️ Send — send selected text to the conversation composer. */
export function SendToChatIcon({ size }: IconProps): ReactNode {
  return svg(size, `<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>`)
}

/** Get the icon for a config type. */
export function typeIcon(type: string, size: number): ReactNode {
  switch (type) {
    case 'npm': return NpmIcon({ size })
    case 'springboot': return SpringIcon({ size })
    case 'python': return PythonIcon({ size })
    default: return CustomIcon({ size })
  }
}
