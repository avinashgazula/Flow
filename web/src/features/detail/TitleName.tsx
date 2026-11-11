import { nameSize } from './nameSize'
import s from './DetailScreen.module.css'

/** The page's one h1, set as the giant uppercase title the Index system opens every page with. The clear-logo art
 *  TMDB has for some titles is not used: it is drawn for dark backgrounds and vanishes on paper, and the title in type
 *  is the design. */
export function TitleName({ title }: { title: string }) {
  return (
    <h1 className={s.name} data-size={nameSize(title)}>
      {title}
    </h1>
  )
}
