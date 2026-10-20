import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Icon, type IconName } from '../../components/Icon'
import type { Source } from '../../lib/sources'
import { useSettings } from '../../lib/store/settings'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import { fileSize, speedLabel, speeds } from './format'
import s from './Controls.module.css'

type Page = 'root' | 'tracks' | 'audio' | 'subtitles' | 'speed' | 'source'

const titles: Record<Page, string> = { root: 'Options', tracks: 'Audio and Subtitles', audio: 'Audio', subtitles: 'Subtitles', speed: 'Speed', source: 'Source' }

interface Row {
  id: string
  icon?: IconName
  title: string
  detail?: string
  value?: string
  checked?: boolean
  chevron?: boolean
  disabled?: boolean
  /** Information, not a choice: set out like a row, but at full strength. */
  plain?: boolean
  action: () => void
}

interface Group {
  title?: string
  rows: Row[]
  footer?: ReactNode
}

const noop = () => {}

/** The player's options as one glass card above the button that opened it. Each row names what's
 *  chosen and opens a list inside the same card, as PlayerOptionsPanel does in the apps. */
export function OptionsPanel({ controller, start, sources, source, onPickSource, onMoreSources }: {
  controller: PlayerController
  start: 'root' | 'tracks'
  sources: Source[]
  source: Source | null
  onPickSource: (source: Source) => void
  onMoreSources: () => void
}) {
  const [page, setPage] = useState<Page>(start)
  const audio = usePlayer(controller, (st) => st.audio)
  const audioId = usePlayer(controller, (st) => st.audioId)
  const subtitles = usePlayer(controller, (st) => st.subtitles)
  const subtitleId = usePlayer(controller, (st) => st.subtitleId)
  const blocked = usePlayer(controller, (st) => st.blocked)
  const proxyError = usePlayer(controller, (st) => st.proxyError)
  const rate = usePlayer(controller, (st) => st.rate)
  const fit = usePlayer(controller, (st) => st.fit)
  const close = () => controller.setPanel(null)
  const back = () => setPage(start === 'tracks' && page !== 'root' ? 'tracks' : 'root')

  const proxy = useSettings((st) => st.streamProxy) !== ''
  const currentAudio = audio.find((t) => t.id === audioId)
  const currentSubtitle = subtitles.find((t) => t.id === subtitleId)

  // What the source says it carries ("English · Hindi"), for when the engine can't list tracks itself.
  const listed = source?.languages?.length ? source.languages.join(' · ') : undefined
  /** The audio choices, or an honest account of why there aren't any: the browser is picking the
   *  track itself (a host that blocks web pages), or the stream carries one track and says so. */
  const audioGroup = (after: () => void, title?: string): Group => {
    if (audio.length > 0) {
      return {
        title,
        rows: audio.map((t) => ({
          id: `a${t.id}`,
          title: t.label,
          detail: t.unavailable ?? t.note,
          disabled: !!t.unavailable,
          checked: t.id === audioId,
          action: () => {
            void controller.selectAudio(t.id)
            after()
          },
        })),
      }
    }
    if (blocked) {
      return {
        title,
        rows: [{ id: 'browser', title: 'Chosen by the Browser', detail: listed && `The source lists ${listed}`, checked: true, disabled: true, plain: true, action: noop }],
        footer: proxy ? (
          <>
            Your stream proxy couldn’t open this file, so the browser plays it and picks the audio itself.
            {proxyError && <span className={s.groupReason}>{proxyError}</span>}
          </>
        ) : (
          <>
            A stream proxy, added in <Link to="/settings" hash="playback">Settings → Playback</Link>, lets Flow offer every audio track.
          </>
        ),
      }
    }
    return {
      title,
      rows: [listed ? { id: 'listed', title: listed, detail: 'Listed by the source', disabled: true, plain: true, action: noop } : { id: 'default', title: 'Default', checked: true, disabled: true, plain: true, action: noop }],
    }
  }
  const subtitleRows = (after: () => void): Row[] => [
    {
      id: 'off',
      title: 'Off',
      checked: subtitleId === null,
      action: () => {
        void controller.selectSubtitle(null)
        after()
      },
    },
    ...subtitles.map((t) => ({
      id: `s${t.id}`,
      title: t.label,
      detail: t.unavailable ?? (t.id.startsWith('ext:') ? 'From the source' : undefined),
      disabled: !!t.unavailable,
      checked: t.id === subtitleId,
      action: () => {
        void controller.selectSubtitle(t.id)
        after()
      },
    })),
  ]

  let groups: Group[]
  switch (page) {
    case 'root': {
      const rows: Row[] = []
      rows.push({ id: 'audio', icon: 'music', title: currentAudio?.label ?? audioGroup(noop).rows[0]!.title, chevron: true, action: () => setPage('audio') })
      rows.push({ id: 'subtitles', icon: 'subtitles', title: currentSubtitle ? currentSubtitle.label : 'Subtitles Off', chevron: true, action: () => setPage('subtitles') })
      rows.push({
        id: 'source',
        icon: 'stack',
        title: source ? [source.provider, source.resolution].filter(Boolean).join(' · ') : 'Source',
        chevron: true,
        action: () => setPage('source'),
      })
      rows.push({ id: 'speed', icon: 'gauge', title: `Speed · ${speedLabel(rate)}`, chevron: true, action: () => setPage('speed') })
      rows.push({
        id: 'zoom',
        icon: fit === 'cover' ? 'exitFullscreen' : 'fullscreen',
        title: `Zoom · ${fit === 'cover' ? 'Fill' : 'Fit'}`,
        action: () => controller.setFit(fit === 'cover' ? 'contain' : 'cover'),
      })
      groups = [{ rows }]
      break
    }
    case 'tracks':
      groups = [audioGroup(noop, 'Audio'), { title: 'Subtitles', rows: subtitleRows(close) }]
      break
    case 'audio':
      groups = [audioGroup(back)]
      break
    case 'subtitles':
      groups = [{ rows: subtitleRows(back) }]
      break
    case 'speed':
      groups = [{ rows: speeds.map((r) => ({ id: `r${r}`, title: speedLabel(r), checked: r === rate, action: () => (controller.setRate(r), back()) })) }]
      break
    case 'source':
      groups = [
        {
          rows: [
            ...sources.map((x) => ({
              id: x.id,
              title: x.provider,
              detail: [x.resolution, fileSize(x.sizeBytes), ...(x.hdr ?? []), x.audio?.[0], x.title].filter(Boolean).join(' · '),
              checked: x.id === source?.id,
              disabled: !!x.unsupported && x.id !== source?.id,
              action: () => {
                close()
                if (x.id !== source?.id) onPickSource(x)
              },
            })),
            { id: 'more', icon: 'search', title: 'More Sources…', action: () => (close(), onMoreSources()) },
          ],
        },
      ]
      break
  }

  const showHeader = page !== 'root' && page !== start
  return (
    <div className={`${s.panel} ${s.interactive}`} role="dialog" aria-label={titles[page]} onPointerEnter={() => (controller.hovering = true)} onPointerLeave={() => (controller.hovering = false)}>
      {showHeader && (
        <button className={s.panelHeader} onClick={back} onMouseDown={keepFocus} aria-label={`Back to ${titles[start === 'tracks' ? 'tracks' : 'root']}`}>
          <Icon name="chevronLeft" size={16} strokeWidth={2.6} />
          <span>{titles[page]}</span>
        </button>
      )}
      <div className={s.panelScroll}>
        {groups.map((g, i) => (
          <div key={g.title ?? i} role="group" aria-label={g.title}>
            {g.title && <p className={s.groupTitle}>{g.title}</p>}
            {g.rows.map((row) => (
              <button key={row.id} className={s.row} data-plain={row.plain ? '' : undefined} onClick={row.action} onMouseDown={keepFocus} disabled={row.disabled} role={row.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={row.checked}>
                {row.icon && (
                  <span className={s.rowIcon}>
                    <Icon name={row.icon} size={18} strokeWidth={2} />
                  </span>
                )}
                <span className={s.rowText}>
                  <span className={s.rowTitle} data-checked={row.checked ? '' : undefined}>
                    {row.title}
                  </span>
                  {row.detail && <span className={s.rowDetail}>{row.detail}</span>}
                </span>
                {row.value && <span className={s.rowValue}>{row.value}</span>}
                {row.checked && <Icon name="check" size={16} strokeWidth={2.8} />}
                {row.chevron && (
                  <span className={s.chevron}>
                    <Icon name="chevronRight" size={14} strokeWidth={2.6} />
                  </span>
                )}
              </button>
            ))}
            {g.footer && <p className={s.groupFooter}>{g.footer}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
