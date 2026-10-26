import { useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Icon, type IconName } from '../../components/Icon'
import { PlayerIcon, type PlayerIconName } from './playerIcons'
import type { Source } from '../../lib/sources'
import { useSettings } from '../../lib/store/settings'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import { externalPlayerTitle, playersFor } from './externalPlayers'
import { BoostPage, DelayPage } from './ExtraPages'
import { fileSize, speedLabel, speeds } from './format'
import { sleepChoices, sleepTitle } from './sleepTimer'
import { delayLabel } from './subtitleDelay'
import { StylePage } from './StylePage'
import { SubtitleSearchPage } from './SubtitleSearch'
import { boostLabel } from './volumeBoost'
import s from './Controls.module.css'

type Page = 'root' | 'tracks' | 'audio' | 'subtitles' | 'search' | 'style' | 'delay' | 'speed' | 'sleep' | 'boost' | 'external' | 'source'

const titles: Record<Page, string> = {
  root: 'Options',
  tracks: 'Audio and Subtitles',
  audio: 'Audio',
  subtitles: 'Subtitles',
  search: 'Search Subtitles',
  style: 'Subtitle Style',
  delay: 'Subtitle Delay',
  speed: 'Speed',
  sleep: 'Sleep Timer',
  boost: 'Volume Boost',
  external: 'Open in',
  source: 'Source',
}

interface Row {
  id: string
  icon?: IconName | PlayerIconName
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

/** The player's options as one flat card above the button that opened it. Each row names what's
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
  const info = usePlayer(controller, (st) => st.info)
  const sleep = usePlayer(controller, (st) => st.sleep)
  const delay = usePlayer(controller, (st) => st.subtitleDelay)
  const boostable = usePlayer(controller, (st) => st.boostable)
  const boost = useSettings((st) => st.volumeBoostDB ?? 0)
  const preferred = useSettings((st) => st.externalPlayer ?? 'none')
  const close = () => controller.setPanel(null)
  // The Subtitle Style page changes what's on screen as you go, so the player shows a sample line and keeps
  // it clear of this panel while the page is open.
  useEffect(() => {
    controller.setStyling(page === 'style' || page === 'delay' ? page : null)
    return () => controller.setStyling(null)
  }, [controller, page])
  // Search Subtitles opens from the subtitle list, in Options or in Audio and Subtitles, and goes back to it.
  const [searchFrom, setSearchFrom] = useState<Page>('subtitles')
  const home: Page = start === 'tracks' ? 'tracks' : 'root'
  const back = () => setPage(page === 'search' ? searchFrom : start === 'tracks' && page !== 'root' ? 'tracks' : 'root')

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
      detail: t.unavailable ?? t.note ?? (t.id.startsWith('ext:') ? 'From the source' : undefined),
      disabled: !!t.unavailable,
      checked: t.id === subtitleId,
      action: () => {
        void controller.selectSubtitle(t.id)
        after()
      },
    })),
  ]

  const searchRow = (from: Page): Row => ({ id: 'search', icon: 'search', title: 'Search Subtitles…', chevron: true, action: () => (setSearchFrom(from), setPage('search')) })
  const styleRow: Row = { id: 'style', icon: 'text', title: 'Subtitle Style', chevron: true, action: () => setPage('style') }
  const delayRow: Row = { id: 'delay', icon: 'clock', title: `Subtitle Delay · ${delayLabel(delay)}`, chevron: true, action: () => setPage('delay') }
  // "Open in" is offered where an app can take the stream by its address (see externalPlayers.ts).
  const external = controller.externalLink()
  const apps = external ? playersFor(external.platform, preferred) : []
  const lead = apps.find((id) => id === preferred)
  let groups: Group[] = []
  switch (page) {
    case 'root': {
      const rows: Row[] = []
      rows.push({ id: 'audio', icon: 'music', title: `Audio · ${currentAudio?.label ?? audioGroup(noop).rows[0]!.title}`, chevron: true, action: () => setPage('audio') })
      rows.push({ id: 'subtitles', icon: 'subtitles', title: currentSubtitle ? `Subtitles · ${currentSubtitle.label}` : 'Subtitles Off', chevron: true, action: () => setPage('subtitles') })
      rows.push(styleRow)
      rows.push(delayRow)
      rows.push({
        id: 'source',
        icon: 'stack',
        title: source ? [source.provider, source.resolution].filter(Boolean).join(' · ') : 'Source',
        chevron: true,
        action: () => setPage('source'),
      })
      rows.push({ id: 'speed', icon: 'gauge', title: `Speed · ${speedLabel(rate)}`, chevron: true, action: () => setPage('speed') })
      rows.push({ id: 'sleep', icon: 'moon', title: `Sleep Timer · ${sleep === null ? 'Off' : sleepTitle(sleep)}`, chevron: true, action: () => setPage('sleep') })
      if (boostable) rows.push({ id: 'boost', icon: 'volume', title: `Volume Boost · ${boostLabel(boost)}`, chevron: true, action: () => setPage('boost') })
      rows.push({
        id: 'zoom',
        icon: fit === 'cover' ? 'exitFullscreen' : 'fullscreen',
        title: `Zoom · ${fit === 'cover' ? 'Fill' : 'Fit'}`,
        action: () => controller.setFit(fit === 'cover' ? 'contain' : 'cover'),
      })
      const more: Row[] = [
        {
          id: 'replay',
          icon: 'replay',
          title: 'What Did They Say?',
          detail: 'Back 10 seconds, with subtitles',
          action: () => {
            close()
            controller.replayWithSubtitles()
          },
        },
      ]
      if (lead) more.push({ id: 'open-lead', icon: 'external', title: `Open in ${externalPlayerTitle(lead)}`, action: () => controller.openExternally(lead) })
      if (apps.length > (lead ? 1 : 0)) more.push({ id: 'open', icon: 'external', title: lead ? 'Open in Another App…' : 'Open in…', chevron: true, action: () => setPage('external') })
      more.push({ id: 'info', icon: 'info', title: 'Playback Info', value: info ? 'On' : 'Off', action: controller.toggleInfo })
      groups = [{ rows: rows.slice(0, 4) }, { rows: rows.slice(4) }, { rows: more }]
      break
    }
    case 'tracks':
      groups = [audioGroup(noop, 'Audio'), { title: 'Subtitles', rows: subtitleRows(close) }, { rows: [searchRow('tracks'), styleRow, delayRow] }]
      break
    case 'audio':
      groups = [audioGroup(back)]
      break
    case 'subtitles':
      groups = [{ rows: subtitleRows(back) }, { rows: [searchRow('subtitles')] }]
      break
    case 'search':
    case 'style':
    case 'delay':
    case 'boost':
      break
    case 'sleep':
      groups = [
        {
          rows: [
            { id: 'sleep-off', title: 'Off', checked: sleep === null, action: () => (controller.setSleep(null), back()) },
            ...sleepChoices.map((choice) => ({ id: `sleep-${choice}`, title: sleepTitle(choice), checked: sleep === choice, action: () => (controller.setSleep(choice), back()) })),
          ],
          footer: 'The sound fades over the last 30 seconds, then the picture pauses. End of Episode or Movie lets this one finish and closes the player instead of starting the next.',
        },
      ]
      break
    case 'external':
      groups = [
        {
          rows: apps.map((id) => ({ id: `app-${id}`, icon: 'external' as const, title: externalPlayerTitle(id), action: () => (close(), controller.openExternally(id)) })),
          footer: 'Another player gets the stream’s link (Infuse also the resume point). Flow tracks progress only in its own player, and playback pauses here.',
        },
      ]
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
    <div className={`${s.panel} ${s.interactive}`} data-page={page} role="dialog" aria-label={titles[page]} onPointerEnter={() => (controller.hovering = true)} onPointerLeave={() => (controller.hovering = false)}>
      {showHeader && (
        <button className={s.panelHeader} onClick={back} onMouseDown={keepFocus} aria-label={`Back to ${titles[page === 'search' ? searchFrom : home]}`}>
          <Icon name="chevronLeft" size={16} strokeWidth={2.6} />
          <span>{titles[page]}</span>
        </button>
      )}
      <div className={s.panelScroll}>
        {page === 'style' && <StylePage />}
        {page === 'search' && <SubtitleSearchPage controller={controller} onDone={close} />}
        {page === 'delay' && <DelayPage controller={controller} />}
        {page === 'boost' && <BoostPage controller={controller} />}
        {groups.map((g, i) => (
          <div key={g.title ?? i} role="group" aria-label={g.title}>
            {g.title && <p className={s.groupTitle}>{g.title}</p>}
            {g.rows.map((row) => (
              <button key={row.id} className={s.row} data-plain={row.plain ? '' : undefined} onClick={row.action} onMouseDown={keepFocus} disabled={row.disabled} role={row.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={row.checked}>
                {row.icon && (
                  <span className={s.rowIcon}>
                    <PlayerIcon name={row.icon} size={18} strokeWidth={2} />
                  </span>
                )}
                <span className={s.rowText}>
                  <span className={s.rowTitle} data-checked={row.checked ? '' : undefined}>
                    {row.title}
                  </span>
                  {row.detail && <span className={s.rowDetail}>{row.detail}</span>}
                </span>
                {row.value && <span className={s.rowValue}>{row.value}</span>}
                {row.checked && (
                  <span className={s.check}>
                    <Icon name="check" size={16} strokeWidth={2.8} />
                  </span>
                )}
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
