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
import { injectStyles } from './injectStyles.ts'

/** Services required before mounting: the betterSidebar registry (provided
 *  by dsh-better-sidebar's own client half) and the session store. */
export const inject = ['betterSidebar', 'sessions']

/** Plugin body. */
export function apply(ctx: Context): void {
  // Install the plugin stylesheet up front. The settings panel renders in
  // better-sidebar's gear popup, which can mount before the "服务" tab ever
  // does — injecting from ServicesTab alone left that panel unstyled.
  injectStyles()

  // The "服务" sidebar tab.
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: 'dsh-better-sidebar-starter:services',
      title: () => '服务',
      icon: (size: number): ReactNode => createElement(RocketIcon, { size }),
      order: 50,
      single: true,
      settings: {
        // Switches + runtime path pickers render exclusively through the
        // custom SettingsPanel (the `render` prop). Declaring `pluginToggles`
        // rows here too would make better-sidebar render them alongside the
        // panel, duplicating every switch and the Java/Node/Python paths.
        render: (props): ReactNode => createElement(SettingsPanel, props),
      },
      component: (props): ReactNode => createElement(ServicesTab, props),
    }),
    'dsh-better-sidebar-starter: services tab',
  )
}
