import { useState } from 'react'
import { defaultSrc, srcSet } from '../../lib/tmdb/images'
import s from './DetailScreen.module.css'

/** The page's one h1: the title's own logo art when TMDB has one, else the title in type. The text stays in the
 *  heading either way (hidden from sight when the logo shows), so the page is named for a screen reader, the tab
 *  and a search, and a logo that fails to load falls back to the words. */
export function TitleName({ title, logo }: { title: string; logo?: string }) {
  const [failed, setFailed] = useState<string>()
  const art = logo && failed !== logo ? logo : undefined
  return (
    <h1 className={s.name} data-logo={art ? '' : undefined}>
      {art ? (
        <>
          <span className="sr-only">{title}</span>
          <img
            key={art}
            className={s.logo}
            src={defaultSrc(art, 'logo')}
            srcSet={srcSet(art, 'logo')}
            sizes="(min-width: 721px) 420px, 70vw"
            alt=""
            decoding="async"
            fetchPriority="high"
            draggable={false}
            onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
            onError={() => setFailed(art)}
            ref={(img) => {
              if (img?.complete && img.naturalWidth) img.setAttribute('data-loaded', '')
            }}
          />
        </>
      ) : (
        title
      )}
    </h1>
  )
}
