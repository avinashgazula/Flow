import s from './Logo.module.css'

/* Marquee's mark, drawn in the page rather than loaded: the name in the condensed face over a row of red
   bulbs, as on the sign above a cinema door. It takes its colours from the cell it sits in (the blue block's
   text colour is the lettering and the bulbs' rim), so it reads in both themes. Static on purpose.
   public/icon.svg is the compact version (an M and one bulb) for the favicon and the installed app's icon. */

const bulbs = 7

/** The wordmark with its bulbs. Sized by the font size of whatever holds it. */
export function Logo() {
  return (
    <span className={s.logo} role="img" aria-label="Marquee">
      <span className={s.word} aria-hidden="true">
        Marquee
      </span>
      <span className={s.bulbs} aria-hidden="true">
        {Array.from({ length: bulbs }, (_, i) => (
          <i key={i} />
        ))}
      </span>
    </span>
  )
}

/** The compact mark for narrow spaces: an M and one bulb, the same drawing as the favicon. */
export function Mark() {
  return (
    <svg className={s.mark} viewBox="150 96 216 336" role="img" aria-label="Marquee">
      <path fill="currentColor" d="M146 100h70l40 118 40-118h70v240h-56V204l-30 88h-48l-30-88v136h-56z" />
      <circle className={s.dot} cx="256" cy="402" r="20" strokeWidth="8" />
    </svg>
  )
}
