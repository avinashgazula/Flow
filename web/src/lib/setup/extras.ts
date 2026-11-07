import { createStore } from '../store/createStore'

/* What the last imported setup held that the website has no setting for (the apps' accent colour, download
   limits, a server's "remote" flag…). It is laid back under the website's own values when a setup is exported,
   so a setup that passes through the website comes out the other side whole. Kept apart from Settings: it is
   not something anyone edits, and nothing but the export reads it. */

export interface SetupExtras {
  settings: Record<string, unknown>
  credentials: Record<string, unknown>
}

export const noExtras: SetupExtras = { settings: {}, credentials: {} }

export const setupExtrasStore = createStore<SetupExtras>('setup-extras', noExtras)
