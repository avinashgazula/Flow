import s from './Logo.module.css'

/* Marquee's mark, drawn in the page rather than loaded: an admit-one ticket, as in the app icon. The ticket is the
   red of the mark (--red) with real holes (a notch in each short end and a perforation, cut with a CSS mask so
   the page shows through in both themes), the name in Plex Sans Bold across it and the stub's ring at the right.
   The lettering and ring take --onblue, the colour of text on a solid mark. Static on purpose.
   public/icon.svg is the compact version (an M and one bulb) for the favicon and the installed app's icon. */

/** The wordmark as a ticket. Sized by the font size of whatever holds it. */
export function Logo() {
  return (
    <span className={s.logo} role="img" aria-label="Marquee">
      <span className={s.word} aria-hidden="true">
        Marquee
      </span>
      <span className={s.ring} aria-hidden="true" />
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
