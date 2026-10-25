import { Icon } from '../../components/Icon'
import type { Source } from '../../lib/sources'
import type { SourceAppearance } from '../../lib/sources/sourceSettings'
import { playFacts } from '../detail/logic'
import { resolutionText, rowText, spokenLabel } from './labels'
import s from './SourcePicker.module.css'

export const optionId = (source: Source) => `source-${source.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`

/** One source as a film-can label row: the resolution large on the left; then the format line in edge
 *  print, the row's title, and its facts in ink-3, as Settings → Sources → Appearance says. The best match has
 *  the yellow Play (a cue: the whole row plays); one that can't play is dimmed and says why in words.
 *  `providerAbove`: a heading already names the provider. */
export function SourceRow({
  source,
  appearance,
  providerAbove,
  active,
  best,
  lastPlayed,
  divider,
  onPick,
  onHover,
}: {
  source: Source
  appearance: SourceAppearance
  providerAbove: boolean
  active: boolean
  best: boolean
  lastPlayed: boolean
  divider: boolean
  onPick: (s: Source) => void
  onHover: (id: string) => void
}) {
  const text = rowText(source, appearance, providerAbove)
  const facts = source.unsupported ? undefined : playFacts(source)
  const notes = [...(source.cached === false ? [{ text: 'Not cached', tone: 'warn' as const }] : []), ...(facts?.notes ?? [])]
  // The add-on's own text stands in for the facts when it has any; a server's rows have none, so they keep theirs.
  const showMeta = text.meta && text.raw.length === 0
  return (
    <div
      id={optionId(source)}
      role="option"
      aria-selected={active}
      aria-disabled={source.unsupported ? true : undefined}
      aria-label={spokenLabel(source, lastPlayed, { provider: !providerAbove, size: appearance.showSize })}
      className={s.row}
      data-active={active ? '' : undefined}
      data-divider={divider ? '' : undefined}
      data-compact={appearance.compact ? '' : undefined}
      onClick={() => onPick(source)}
      onPointerEnter={() => !source.unsupported && onHover(source.id)}
    >
      <span className={s.resolution}>{resolutionText(source) ?? '–'}</span>
      <span className={s.body}>
        <span className={s.content}>
          {text.formats && <span className={s.formats}>{text.formats}</span>}
          <span className={s.release}>{text.title}</span>
          {text.raw.length > 0 && <span className={s.raw}>{text.raw.join('\n')}</span>}
          {showMeta && <span className={s.meta}>{text.meta}</span>}
          {notes.length > 0 && (
            <span className={s.notesLine}>
              {notes.map((n, i) => (
                <span key={n.text} className={n.tone === 'warn' ? s.warn : undefined}>
                  {i > 0 && ' · '}
                  {n.text}
                </span>
              ))}
            </span>
          )}
        </span>
        {source.unsupported && <span className={s.unsupported}>{source.unsupported}</span>}
      </span>
      {best && (
        <span className={`btn btn-primary btn-compact ${s.play}`} aria-hidden>
          <Icon name="play" size={14} /> Play
        </span>
      )}
    </div>
  )
}
