/* Explore's sorts. Apart from source.ts because the route reads the sort from an address at first load. */

export const exploreSorts = [
  { id: 'trending', label: 'Trending' },
  { id: 'popular', label: 'Popular' },
  { id: 'top', label: 'Top Rated' },
  { id: 'new', label: 'Newest' },
] as const

export type ExploreSort = (typeof exploreSorts)[number]['id']

export const parseSort = (value: unknown): ExploreSort => (exploreSorts.some((s) => s.id === value) ? (value as ExploreSort) : 'trending')
