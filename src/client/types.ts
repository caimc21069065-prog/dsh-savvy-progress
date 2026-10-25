/**
 * Type-only ambient imports for the client bundle.
 *
 * Every import here is `import type` — esbuild erases them, so the shipped
 * `lib/client.js` requires nothing beyond `react` from the browser module
 * table. They exist to pull in the slot-contract declaration merges
 * (SlotMap, LocaleNamespaceMap, Context services, standard session props)
 * for type-checking.
 */

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS, SavvyDictionary } from './locales.ts'
import type { SavvyAgentRow } from '../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-savvy-progress band and panel copy. */
    savvyProgress: keyof SavvyDictionary
  }
}

/** Business face injected into the band registration. */
export interface BandInjected {
  /** Open the agents panel in the right sidebar (no-op when unavailable). */
  openPanel: () => void
}

/** Full props of the composer-dock band component. */
export type ProgressBandProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS> & BandInjected

/** Business face injected into the panel-body registration. */
export interface PanelInjected {
  /**
   * Open one continuable subagent's session in the main conversation view.
   * @param row - the row to open.
   */
  openChild: (row: SavvyAgentRow) => void
}

/** Full props of the right-sidebar panel body component. */
export type AgentsPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof NS> & PanelInjected
