import type { Source } from '../../lib/sources'

/* What a source's menu offers, as the apps' source picker does on a long press or right-click: the same pick as a tap,
   and the release's file name, which the rows keep out of sight. The stream's address is never offered: it can be a
   debrid link or carry a key, and a link pasted somewhere else is a link given away. */

export type SourceAction = 'play' | 'copyName'

export const sourceActionLabels: Record<SourceAction, string> = { play: 'Play', copyName: 'Copy File Name' }

export function sourceActions(source: Pick<Source, 'unsupported' | 'filename'>): SourceAction[] {
  const name = source.filename?.trim()
  return [...(source.unsupported ? [] : (['play'] as const)), ...(name ? (['copyName'] as const) : [])]
}
