/* Reads an XMLTV guide off the main thread. A provider's guide can run to hundreds of megabytes once
   unpacked; here it is fetched, unpacked and picked through as it arrives, and only the programmes Flow
   keeps are sent back. The page decides which addresses to try (it knows the stream proxy setting); this
   only carries them out. */

import { fetchPlanned, LiveTVError, type Attempt } from './net'
import { readXMLTV } from './xmltv'
import type { EPG } from './types'

export interface GuideRequest {
  url: string
  attempts: Attempt[]
  keep: { from: number; to: number; channels?: string[] }
}

export type GuideResponse = { ok: true; epg: EPG; viaProxy: boolean; directBlocked: boolean } | { ok: false; message: string }

self.onmessage = async (event: MessageEvent<GuideRequest>) => {
  const { url, attempts, keep } = event.data
  let reply: GuideResponse
  try {
    const fetched = await fetchPlanned(url, { attempts }, { timeoutMs: 120_000 })
    if (!fetched.response.body) throw new LiveTVError('This browser can’t read the guide as it downloads. Try a current Chrome, Edge, Safari or Firefox.')
    const epg = await readXMLTV(fetched.response.body, { from: keep.from, to: keep.to, channels: keep.channels ? new Set(keep.channels) : undefined })
    reply = { ok: true, epg, viaProxy: fetched.viaProxy, directBlocked: fetched.directBlocked }
  } catch (error) {
    reply = { ok: false, message: error instanceof Error ? error.message : 'The guide couldn’t be read.' }
  }
  ;(self as unknown as { postMessage(message: GuideResponse): void }).postMessage(reply)
}
