/** The web README, as CI knows where it lives (vite.config.ts); a local build has no address, so no link. */
const readme = import.meta.env.VITE_WEB_README as string | undefined

/** A footer's way to the detail it leaves out (which hosts a proxy must allow, why a service can't be read from a web
 *  page). The sentence before it says what the viewer needs; this is for the one who wants the rest. */
export function LearnMore({ section }: { section: string }) {
  if (!readme) return null
  return (
    <>
      {' '}
      <a href={`${readme}#${section}`} target="_blank" rel="noreferrer">
        Learn more
      </a>
      .
    </>
  )
}
