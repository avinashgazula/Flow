import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { flash } from '../components/flash'
import { airedEpisodes, nextUp } from '../features/home/continue'
import { watchedShowsOf } from '../features/home/marks'
import { candidates, nothingToContinue } from '../features/home/resumeLatest'
import { continueLink } from '../features/home/skipDetails'
import { q } from '../lib/queries'
import { libraryStore } from '../lib/store/library'
import { useSkipDetails } from '../lib/store/settings'

/* `/continue`: the most recently watched title, opened the way a Continue Watching card opens it (the player, or the title
   page when Skip Details is off). It is what the PWA's Continue Watching shortcut and the Go shortcut G then C open, and it
   leaves no entry of its own in the history. With nothing to continue it opens Library → Continue Watching and says so. */

export const Route = createFileRoute('/continue')({
  // Nothing to load first: the page chooses where to go from the library as it opens.
  loader: () => null,
  component: ContinueRoute,
})

function ContinueRoute() {
  // useRouter, not useNavigate: see LazyCardMenu.
  const { navigate } = useRouter()
  const client = useQueryClient()
  const skipDetails = useSkipDetails()

  useEffect(() => {
    let live = true
    void (async () => {
      const lib = libraryStore.get()
      for (const c of candidates(lib.progress, lib.history)) {
        if (c.kind === 'resume') {
          if (live) void navigate({ ...continueLink({ item: c.progress.item, progress: c.progress }, skipDetails), replace: true })
          return
        }
        // A series watched to an episode's end: its next episode, once its seasons are known.
        const detail = await client.fetchQuery(q.detail('show', c.item.id)).catch(() => undefined)
        const next = detail && nextUp(watchedShowsOf(lib.watchedEpisodes, lib.rewatches).get(c.item.id) ?? [], airedEpisodes(detail, Date.now()))
        if (!next) continue
        if (live) void navigate({ ...continueLink({ item: c.item, episode: next }, skipDetails), replace: true })
        return
      }
      if (!live) return
      void navigate({ to: '/library', search: { list: 'continue' }, replace: true })
      flash(nothingToContinue, 5000)
    })()
    return () => {
      live = false
    }
    // Once: the choice is made from what the library holds as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="page" aria-busy="true">
      <p className="muted" role="status">
        Opening what you were watching…
      </p>
    </div>
  )
}
