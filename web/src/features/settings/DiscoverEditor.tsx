import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Segmented } from '../../components/Choice'
import { movieGenres, tvGenres } from '../../lib/genres'
import { useWatchProviders } from '../../lib/providers'
import { q } from '../../lib/queries'
import { discoverSorts, newQuery, type DiscoverQuery, type DiscoverSort, type ShelfConfig } from '../../lib/shelfDefaults'
import { sortLabel } from '../../lib/shelves'
import { useSettings } from '../../lib/store/settings'
import { imageURL } from '../../lib/tmdb/images'
import type { MediaType } from '../../lib/tmdb/types'
import { filterLanguages } from '../explore/filterQuery'
import { discoverParams } from '../home/shelfQuery'
import { Group, Select } from './controls'
import s from './SettingsScreen.module.css'

/* One Discover shelf, new or being edited: a title, the kind of title, and the filters the apps' editor has
   (genres, release window or years, rating, language, streaming services), with a preview of what it holds. */

const types = [
  { id: 'movie' as MediaType, label: 'Movies' },
  { id: 'show' as MediaType, label: 'TV Shows' },
]

/** When it was released, as relative days (so a shelf can always point at what's coming): from and to, counted from today. */
const releases = [
  { value: 'any', label: 'Any Time', from: undefined, to: undefined },
  { value: 'last30', label: 'Last 30 Days', from: -30, to: 0 },
  { value: 'last90', label: 'Last 90 Days', from: -90, to: 0 },
  { value: 'next30', label: 'Next 30 Days', from: 0, to: 30 },
  { value: 'next180', label: 'Next 6 Months', from: 0, to: 180 },
] as const

const releaseOf = (query: DiscoverQuery) => releases.find((r) => r.from === query.releasedFromDays && r.to === query.releasedToDays)?.value

const ratings = [{ value: 'any', label: 'Any Rating' }, ...[5, 6, 7, 8, 9].map((n) => ({ value: String(n), label: `${n}+` }))]
const languages = [{ value: 'any', label: 'Any Language' }, ...filterLanguages.map((l) => ({ value: l.id, label: l.label }))]
const sorts = discoverSorts.map((value) => ({ value, label: sortLabel(value) }))

const yearOf = (text: string): number | undefined => {
  const n = Number(text)
  return /^\d{4}$/.test(text.trim()) && n >= 1900 && n <= 2100 ? n : undefined
}

export function DiscoverEditor({ shelf, onSave, onCancel }: { shelf?: ShelfConfig; onSave: (title: string, query: DiscoverQuery) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(shelf?.title ?? '')
  const [query, setQuery] = useState<DiscoverQuery>(shelf?.source.kind === 'discover' ? shelf.source.query : newQuery())
  const [from, setFrom] = useState(query.yearFrom?.toString() ?? '')
  const [to, setTo] = useState(query.yearTo?.toString() ?? '')
  const { providers } = useWatchProviders(query.type)
  const region = useSettings((x) => x.region)
  const preview = useQuery(q.discover(query.type, discoverParams(query, region, new Date().setHours(0, 0, 0, 0))))

  const patch = (change: Partial<DiscoverQuery>) => setQuery((cur) => ({ ...cur, ...change }))
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const genres = query.type === 'movie' ? movieGenres : tvGenres
  const release = releaseOf(query)
  const windowed = query.releasedFromDays !== undefined || query.releasedToDays !== undefined

  return (
    <Group title={shelf ? 'Edit Shelf' : 'New Discover Shelf'}>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) onSave(title, query)
        }}
      >
        <label className={s.fieldLabel} htmlFor="shelf-title">
          Shelf Title
        </label>
        <input id="shelf-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Anime Series" maxLength={120} autoComplete="off" autoFocus={!shelf} />

        <span className={s.fieldLabel} id="shelf-type">
          Type
        </span>
        <Segmented
          options={types}
          value={query.type}
          label="Type"
          // Genres are different lists for films and series, and so are the services a region carries.
          onChange={(type) => type !== query.type && setQuery({ ...query, type, genres: [], excludedGenres: [], watchProviders: [] })}
        />

        <label className={s.fieldLabel} htmlFor="shelf-sort">
          Sort By
        </label>
        <Select id="shelf-sort" value={query.sort} onChange={(sort: DiscoverSort) => patch({ sort })} options={sorts} label="Sort by" />

        <span className={s.fieldLabel} id="shelf-genres">
          Genres
        </span>
        <div className={s.chips} role="group" aria-labelledby="shelf-genres">
          {Object.entries(genres).map(([id, name]) => (
            <button key={id} type="button" className="chip" aria-pressed={query.genres.includes(Number(id))} onClick={() => patch({ genres: toggle(query.genres, Number(id)) })}>
              {name}
            </button>
          ))}
        </div>

        <label className={s.fieldLabel} htmlFor="shelf-release">
          Released
        </label>
        <Select
          id="shelf-release"
          value={release ?? 'custom'}
          onChange={(v) => {
            const r = releases.find((x) => x.value === v)
            if (r) patch({ releasedFromDays: r.from, releasedToDays: r.to })
          }}
          options={[...releases.map((r) => ({ value: r.value as string, label: r.label })), ...(release ? [] : [{ value: 'custom', label: 'Custom (kept as is)' }])]}
          label="Released"
        />

        <div className={s.pair}>
          <div>
            <label className={s.fieldLabel} htmlFor="shelf-from">
              Year From
            </label>
            <input
              id="shelf-from"
              className="field"
              inputMode="numeric"
              placeholder="1990"
              maxLength={4}
              value={from}
              disabled={windowed}
              onChange={(e) => {
                setFrom(e.target.value)
                patch({ yearFrom: yearOf(e.target.value) })
              }}
            />
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="shelf-to">
              Year To
            </label>
            <input
              id="shelf-to"
              className="field"
              inputMode="numeric"
              placeholder="2024"
              maxLength={4}
              value={to}
              disabled={windowed}
              onChange={(e) => {
                setTo(e.target.value)
                patch({ yearTo: yearOf(e.target.value) })
              }}
            />
          </div>
        </div>

        <div className={s.pair}>
          <div>
            <label className={s.fieldLabel} htmlFor="shelf-rating">
              Minimum Rating
            </label>
            <Select id="shelf-rating" value={query.minRating === undefined ? 'any' : String(Math.floor(query.minRating))} onChange={(v) => patch({ minRating: v === 'any' ? undefined : Number(v) })} options={ratings} label="Minimum rating" />
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="shelf-language">
              Original Language
            </label>
            <Select id="shelf-language" value={query.originalLanguage ?? 'any'} onChange={(v) => patch({ originalLanguage: v === 'any' ? undefined : v })} options={languages} label="Original language" />
          </div>
        </div>

        {providers.length > 0 && (
          <>
            <span className={s.fieldLabel} id="shelf-services">
              Streaming On
            </span>
            <div className={s.chips} role="group" aria-labelledby="shelf-services">
              {providers.slice(0, 14).map((p) => (
                <button key={p.id} type="button" className="chip" aria-pressed={query.watchProviders.includes(p.id)} onClick={() => patch({ watchProviders: toggle(query.watchProviders, p.id) })}>
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}

        <span className={s.fieldLabel} id="shelf-preview">
          Preview
        </span>
        <div className={s.shelfPreview} aria-labelledby="shelf-preview" role="group" aria-busy={preview.isPending || undefined}>
          {preview.isPending ? (
            <span className={s.hint}>Loading…</span>
          ) : preview.data && preview.data.results.length > 0 ? (
            preview.data.results.slice(0, 12).map((m) => <img key={`${m.type}${m.id}`} src={imageURL(m.poster, 154)} alt={m.title} width={60} height={90} loading="lazy" decoding="async" />)
          ) : (
            <span className={s.hint}>{preview.isError ? 'Couldn’t load a preview. The shelf will try again on Home.' : 'Nothing matches these filters. Try fewer of them.'}</span>
          )}
        </div>

        <div className={s.actions}>
          <button type="button" className="btn btn-secondary btn-compact" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-compact" disabled={!title.trim()}>
            Save Shelf
          </button>
        </div>
      </form>
    </Group>
  )
}
