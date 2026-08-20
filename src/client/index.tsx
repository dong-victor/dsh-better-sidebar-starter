/**
 * Client half of the dsh-better-sidebar-starter plugin: registers the
 * "服务" (Services) sidebar tab through the `ctx.betterSidebar` service.
 * The tab renders a split-pane panel: left config tree + right log/detail.
 * The host half (same package) owns the session-scoped config/process routes.
 * @module dsh-better-sidebar-starter/client
 */

import { createElement, type ReactNode } from 'react'
import type { Context } from 'cordis'
// Triggers the ctx.betterSidebar type augmentation (erased at build).
import type {} from 'dsh-better-sidebar'
import { ServicesTab } from './ServicesTab.tsx'
import { SettingsPanel } from './SettingsPanel.tsx'
import { RocketIcon } from './icons.tsx'

/** Services required before mounting: the betterSidebar registry (provided
 *  by dsh-better-sidebar's own client half) and the session store. */
export const inject = ['betterSidebar', 'sessions']

/** Plugin body. */
export function apply(ctx: Context): void {
  // The "服务" sidebar tab.
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: 'dsh-better-sidebar-starter:services',
      title: () => '服务',
      icon: (size: number): ReactNode => createElement(RocketIcon, { size }),
      order: 50,
      single: true,
      settings: {
        pluginToggles: [
          { key: 'autoSelectOnStart', type: 'switch', title: '启动后自动选中日志' },
          { key: 'autoScroll', type: 'switch', title: '自动滚动到最新日志' },
          { key: 'javaHome', type: 'text', title: 'Java 主目录 (JAVA_HOME)', desc: 'Spring Boot 用的 JDK 路径，留空则自动查找' },
          { key: 'nodePath', type: 'text', title: 'Node.js 路径', desc: 'npm 命令用的 Node 路径，留空则用系统默认' },
          { key: 'pythonPath', type: 'text', title: 'Python 路径', desc: 'Python 命令用的解释器路径，留空则用系统默认' },
        ],
        render: (props): ReactNode => createElement(SettingsPanel, props),
      },
      component: (props): ReactNode => createElement(ServicesTab, props),
    }),
    'dsh-better-sidebar-starter: services tab',
  )
}
