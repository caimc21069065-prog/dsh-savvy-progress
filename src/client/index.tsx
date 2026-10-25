/**
 * dsh-savvy-progress browser half: registers the locale dictionaries, the
 * progress band in the composer's input dock, and — when the right-sidebar
 * and workspace services are composed — the `savvy-agents` panel tab.
 *
 * @module dsh-savvy-progress/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from './types.ts'
import { ProgressBand } from './Band.tsx'
import { AgentsPanel } from './Panel.tsx'
import { NS, zh, en } from './locales.ts'
import type { SavvyAgentRow } from '../types.ts'

/** Structural views of optional navigation services (typed loosely on purpose). */
interface SidebarRightLike {
  openTab(kind: string, options?: unknown): void
}

interface UiWorkspaceLike {
  openSession(target: { parentSessionId: string; childSessionId: string; mode: 'continuable' } | string): void
}

interface ServicesLike {
  sidebarRight?: SidebarRightLike
  uiWorkspace?: UiWorkspaceLike
}

/** Tab-kind identity for the registered page type. */
const TAB_KIND = 'savvy-agents'
/** Registration id under this plugin's package name. */
const TAB_ID = 'dsh-savvy-progress'

export const inject = ['slots', 'locale']

/**
 * Client plugin body.
 * @param ctx - client root context carrying the slot and locale services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'savvy-progress: dictionaries')

  // Band: above the composer, on every session view. Opening the panel is a
  // best-effort navigation — a composition without the right sidebar no-ops.
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: TAB_ID,
    order: 10,
    locale: NS,
    inject: () => ({
      openPanel: () => {
        try {
          ;(ctx as unknown as ServicesLike).sidebarRight?.openTab(TAB_KIND)
        } catch {
          // Panel composition absent: the band stays informational only.
        }
      },
    }),
  }, ProgressBand)), 'savvy-progress: progress band')

  // Panel: two-stage registration through the right-sidebar services.
  ctx.inject(['sidebarRight', 'sidebarRightTabs', 'uiWorkspace'], (panelCtx) => {
    const services = panelCtx as unknown as ServicesLike
    const openChild = (row: SavvyAgentRow) => {
      if (row.mode !== 'continuable' || !row.parentId) return
      try {
        services.uiWorkspace?.openSession({ parentSessionId: row.parentId, childSessionId: row.id, mode: 'continuable' })
      } catch {
        // Navigation refused (session gone): ignore.
      }
    }

    panelCtx.effect(() => panelCtx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => panelCtx.locale.bind(NS)('panel.title'),
      priority: 'extension',
      guide: [{
        id: 'savvy-agents',
        order: 40,
        title: () => panelCtx.locale.bind(NS)('panel.title'),
        description: () => panelCtx.locale.bind(NS)('panel.subtitle'),
      }],
    }), 'savvy-progress: tab type')

    panelCtx.effect(() => panelCtx.slots.inject('sidebar.right.pane.tab', () => panelCtx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
      locale: NS,
      inject: () => ({ openChild }),
    }, AgentsPanel)), 'savvy-progress: panel body')
  })
}
