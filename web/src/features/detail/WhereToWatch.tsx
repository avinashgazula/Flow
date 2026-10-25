import { brandName, providerLogo } from '../../lib/providers'
import type { MediaDetail, Provider } from '../../lib/tmdb/types'
import s from './DetailScreen.module.css'

const kinds = [
  { key: 'stream', label: 'Subscription' },
  { key: 'free', label: 'Free' },
  { key: 'rent', label: 'Rent' },
  { key: 'buy', label: 'Buy' },
] as const

/** True when there is a service to show: what decides whether the section is there at all. */
export const hasProviders = (p: MediaDetail['providers']) => kinds.some((k) => (p[k.key] ?? []).length > 0)

/** The services carrying the title in the viewer's region, one row for each way to watch it (as the apps: with a
 *  subscription, free, to rent, to buy), each service a small square logo. The name is the link's spoken name and
 *  its tooltip; a service with no logo is its name set in the square. Every square opens JustWatch's page. */
export function WhereToWatch({ providers }: { providers: MediaDetail['providers'] }) {
  return (
    <section className={s.section} aria-labelledby="where-title">
      <div className={s.sectionHead}>
        <h2 id="where-title" className={s.sectionTitle}>
          Where to Watch
        </h2>
        <p className={s.attribution}>Data from JustWatch</p>
      </div>
      <dl className={s.providers}>
        {kinds.map(({ key, label }) => {
          const list = providers[key] ?? []
          return list.length ? (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <ul className={s.services}>
                  {list.map((p) => (
                    <li key={p.id}>
                      <Service provider={p} label={label} href={providers.link} />
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null
        })}
      </dl>
    </section>
  )
}

function Service({ provider, label, href }: { provider: Provider; label: string; href?: string }) {
  const name = brandName(provider.name)
  const logo = providerLogo(provider.logo)
  const inside = logo ? <img src={logo.src} srcSet={logo.srcSet} width={44} height={44} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className={s.serviceName}>{name}</span>
  const spoken = `${name}, ${label.toLowerCase()}`
  return href ? (
    <a className={s.service} href={href} target="_blank" rel="noreferrer" title={name} aria-label={`${spoken}. Opens JustWatch.`}>
      {inside}
    </a>
  ) : (
    <span className={s.service} role="img" title={name} aria-label={spoken}>
      {inside}
    </span>
  )
}
