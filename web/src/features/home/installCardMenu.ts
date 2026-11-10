import CardMenu from './CardMenu'
import { provideCardMenu } from './LazyCardMenu'

/* Imported for its effect by the pages that draw posters, so their own chunk carries the card menu. It is not imported by
   the first page: a dynamic import from the shared card code made the bundler pull the router out of the entry chunk and
   add 3 KB to every first load. */
provideCardMenu(CardMenu)
