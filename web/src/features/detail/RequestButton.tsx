import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { canRequest, latestSeason, mediaStatus, request, statusWords, type RequestStatus, type SeerrConfig, type SeerrSeasons } from '../../lib/requests/seerr'
import { useSettings } from '../../lib/store/settings'
import type { MediaDetail } from '../../lib/tmdb/types'
import s from './DetailScreen.module.css'

/* Asks the viewer's Seerr, Overseerr or Jellyseerr for a title that isn't on any of their servers, as the apps'
   Request button. It appears only once Seerr is connected (Settings → Requests), the sources have been searched
   and none of them is a media server, and Seerr has answered. A series asks which seasons first, in place: a dialog
   would hide the page for a choice of two. */

const icons: Record<RequestStatus, IconName> = { notRequested: 'plus', partiallyAvailable: 'plus', pending: 'history', processing: 'refresh', available: 'check' }

/** What the status line says, where it differs from the button's words. */
const stateWords: Partial<Record<RequestStatus, string>> = { available: 'Available in Seerr', pending: 'Requested in Seerr' }

const seerrKey = (c: SeerrConfig, d: MediaDetail) => ['seerr', c.url, d.type, d.id] as const

export function RequestButton({ detail: d, onServer, onNote }: { detail: MediaDetail; onServer: boolean; onNote: (text: string) => void }) {
  const config = useSettings((x) => x.seerr)
  if (!config || onServer) return null
  return <Button config={config} detail={d} onNote={onNote} />
}

function Button({ config, detail: d, onNote }: { config: SeerrConfig; detail: MediaDetail; onNote: (text: string) => void }) {
  const client = useQueryClient()
  const [choosing, setChoosing] = useState(false)
  const question = useRef<HTMLDivElement>(null)
  // The question opens under the button, which on a phone can be behind the tab bar: bring it into view.
  useEffect(() => {
    if (choosing) question.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [choosing])
  const status = useQuery({
    queryKey: seerrKey(config, d),
    queryFn: ({ signal }) => mediaStatus(config, d.type, d.id, { signal }),
    staleTime: 60_000,
    // A wrong address or key is reported where it is set; here a failed lookup just leaves the button out.
    retry: false,
  })
  const ask = useMutation({
    mutationFn: (seasons: SeerrSeasons) => request(config, d.type, d.id, seasons),
    onSuccess: () => {
      client.setQueryData(seerrKey(config, d), 'pending' satisfies RequestStatus)
      onNote(`Requested ${d.title}. It will show up on your servers once it’s downloaded.`)
    },
    onError: (error: Error) => onNote(error.message),
  })

  const current = status.data
  if (!current) return null
  const latest = d.type === 'show' ? latestSeason(d.seasons) : undefined

  function go(seasons: SeerrSeasons) {
    setChoosing(false)
    ask.mutate(seasons)
  }

  // A title Seerr already has, or is already working on, has nothing left to ask: say so in words, as a status,
  // rather than as a button that does nothing.
  if (!canRequest(current) && !ask.isPending) {
    return (
      <span className={s.requestState}>
        <Icon name={icons[current]} size={18} /> {stateWords[current] ?? statusWords[current]}
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-large"
        disabled={ask.isPending}
        aria-expanded={latest !== undefined ? choosing : undefined}
        aria-controls={choosing ? 'request-seasons' : undefined}
        onClick={() => (latest === undefined ? go('all') : setChoosing(!choosing))}
      >
        <Icon name={icons[ask.isPending ? 'processing' : current]} size={18} /> {ask.isPending ? 'Requesting…' : statusWords[current]}
      </button>
      {choosing && latest !== undefined && (
        <div id="request-seasons" ref={question} className={s.seasonsChoice} role="group" aria-label={`Seasons of ${d.title} to request`}>
          <span className={s.seasonsLabel}>Which seasons?</span>
          <button type="button" className={`btn btn-secondary btn-compact ${s.seasonsAnswer}`} onClick={() => go('all')}>
            All Seasons
          </button>
          <button type="button" className={`btn btn-secondary btn-compact ${s.seasonsAnswer}`} onClick={() => go([latest])}>
            Latest Season ({latest})
          </button>
          <button type="button" className={`btn btn-quiet btn-compact ${s.seasonsCancel}`} onClick={() => setChoosing(false)}>
            Cancel
          </button>
        </div>
      )}
    </>
  )
}
