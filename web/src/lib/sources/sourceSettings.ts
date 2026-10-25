/* The settings that decide how found sources are listed: FlowKit's SourceSettings (category and provider
   order, sort rules, filters, result cap) and SourceAppearance, with the same names and defaults. They live
   in their own small file because the settings store needs the defaults at launch and everything else here
   (ranking, the picker, Settings) loads later. */

/** The kinds of place sources come from, as FlowKit's SourceCategory. The browser has media servers and
 *  add-ons today; WebDAV and IPTV keep their places in the saved order for the apps' sake. */
export type SourceCategory = 'mediaServers' | 'webDAV' | 'iptv' | 'addons'
export const sourceCategories: readonly SourceCategory[] = ['mediaServers', 'webDAV', 'iptv', 'addons']
export const categoryNames: Record<SourceCategory, string> = { mediaServers: 'Media Servers', webDAV: 'WebDAV', iptv: 'IPTV / VOD', addons: 'Add-ons' }

export type SourceSortKey = 'resolution' | 'quality' | 'size' | 'cached' | 'seeders' | 'hdr' | 'language'
/** In the order FlowKit lists them, with its titles. */
export const sortKeys: { key: SourceSortKey; title: string }[] = [
  { key: 'resolution', title: 'Resolution' },
  { key: 'quality', title: 'Release Quality' },
  { key: 'size', title: 'File Size' },
  { key: 'cached', title: 'Cached First' },
  { key: 'seeders', title: 'Seeders' },
  { key: 'hdr', title: 'HDR / Dolby Vision' },
  { key: 'language', title: 'Preferred Language' },
]

export interface SourceSortRule {
  key: SourceSortKey
  /** True puts the best first (the most cached, the highest resolution, the largest file). */
  descending: boolean
}

export interface SourceFilters {
  excludeCinemaCaptures: boolean
  excludeUncached: boolean
  /** 0 when there's no minimum. */
  minSizeGB: number | null
  maxSizeGB: number | null
  /** Zero lets any resolution through; otherwise the lowest pixel height that does (480 is SD). */
  minResolution: 0 | 480 | 720 | 1080 | 2160
  requiredKeywords: string[]
  excludedKeywords: string[]
  /** Language names or codes: "English", "en". The first is the most wanted. */
  preferredLanguages: string[]
  excludedCodecs: string[]
}

/** Which row title the picker leads with, as FlowKit's SourceTitleDisplay. */
export type SourceTitleDisplay = 'provider' | 'filename' | 'addonName'
export const titleDisplays: { value: SourceTitleDisplay; label: string }[] = [
  { value: 'provider', label: 'Provider Name' },
  { value: 'filename', label: 'File Name' },
  { value: 'addonName', label: 'Add-on Text' },
]

/** The apps' badge packs are Colored, Monochrome, Minimal and None. Flow Film Stock prints formats as
 *  edge print in one ink, so Colored and Monochrome are the same thing here: `all`. */
export type BadgeSet = 'all' | 'minimal' | 'none'
export const badgeSets: { value: BadgeSet; label: string }[] = [
  { value: 'all', label: 'All Formats' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'none', label: 'None' },
]

export interface SourceAppearance {
  /** Show the add-on's own multi-line text instead of the rows parsed from it. */
  showRawText: boolean
  titleDisplay: SourceTitleDisplay
  badges: BadgeSet
  showSize: boolean
  compact: boolean
}

export interface SourceOrdering {
  useCustomOrdering: boolean
  categoryOrder: SourceCategory[]
  /** Provider ids per category, in display order. A provider not named here follows those that are. */
  providerOrder: Partial<Record<SourceCategory, string[]>>
  sortRules: SourceSortRule[]
  filters: SourceFilters
  /** Null shows every source that passes. */
  resultCap: number | null
  appearance: SourceAppearance
}

export const defaultSortRules = (): SourceSortRule[] => [
  { key: 'cached', descending: true },
  { key: 'resolution', descending: true },
  { key: 'quality', descending: true },
  { key: 'size', descending: true },
]

export const defaultSourceFilters: SourceFilters = {
  excludeCinemaCaptures: true,
  excludeUncached: false,
  minSizeGB: null,
  maxSizeGB: null,
  minResolution: 0,
  requiredKeywords: [],
  excludedKeywords: [],
  preferredLanguages: [],
  excludedCodecs: [],
}

export const defaultSourceAppearance: SourceAppearance = { showRawText: false, titleDisplay: 'provider', badges: 'all', showSize: true, compact: false }

export const defaultSourceOrdering: SourceOrdering = {
  useCustomOrdering: false,
  categoryOrder: [...sourceCategories],
  providerOrder: {},
  sortRules: defaultSortRules(),
  filters: defaultSourceFilters,
  resultCap: null,
  appearance: defaultSourceAppearance,
}

/** Options the pickers in Settings offer, as the Settings → Sources page of the apps lists them. */
export const resultCaps = [5, 10, 15, 20, 30, 50]
export const maxSizes = [2, 5, 10, 20, 40, 80]
export const minSizes = [0.5, 1, 2, 5]
export const minResolutions: { value: SourceFilters['minResolution']; label: string }[] = [
  { value: 0, label: 'Any' },
  { value: 480, label: 'SD' },
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: 2160, label: '4K' },
]

// MARK: - Reading saved values

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isLimit = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0)
const oneOf = <T extends string | number>(list: readonly T[]) => (v: unknown): v is T => list.includes(v as T)

const isCategory = oneOf(sourceCategories)
const isSortKey = oneOf(sortKeys.map((k) => k.key))
const isTitleDisplay = oneOf(titleDisplays.map((t) => t.value))
// The apps' Colored and Monochrome read as All Formats.
const isBadgeSet = (v: unknown) => badgeSets.some((b) => b.value === v) || v === 'colored' || v === 'monochrome'
const isResolution = oneOf<SourceFilters['minResolution']>([0, 480, 720, 1080, 2160])

/** True when `v` can be read as source ordering: every field it has is the right type, and any it lacks takes
 *  its default. This is what a backup file has to pass; `normaliseSourceOrdering` then fills it out. */
export function isSourceOrdering(v: unknown): boolean {
  if (!isObject(v)) return false
  const ok = (key: string, valid: (x: unknown) => boolean) => !(key in v) || valid(v[key])
  const section = (key: string, fields: Record<string, (x: unknown) => boolean>) =>
    ok(key, (x) => isObject(x) && Object.entries(fields).every(([f, valid]) => !(f in x) || valid(x[f])))
  return (
    ok('useCustomOrdering', isBool) &&
    ok('categoryOrder', (x) => Array.isArray(x) && x.every(isCategory)) &&
    ok('providerOrder', (x) => isObject(x) && Object.entries(x).every(([k, ids]) => isCategory(k) && isStrings(ids))) &&
    ok('sortRules', (x) => Array.isArray(x) && x.every((r) => isObject(r) && isSortKey(r.key) && (!('descending' in r) || isBool(r.descending)))) &&
    ok('resultCap', isLimit) &&
    section('filters', {
      excludeCinemaCaptures: isBool,
      excludeUncached: isBool,
      minSizeGB: isLimit,
      maxSizeGB: isLimit,
      minResolution: isResolution,
      requiredKeywords: isStrings,
      excludedKeywords: isStrings,
      preferredLanguages: isStrings,
      excludedCodecs: isStrings,
    }) &&
    section('appearance', { showRawText: isBool, titleDisplay: isTitleDisplay, badges: isBadgeSet, badgePack: isBadgeSet, showSize: isBool, compact: isBool })
  )
}

const limit = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** Source ordering from whatever was saved: anything missing or unreadable takes its default, so settings saved
 *  before a field existed (or a backup from the apps) still load. Safe on a value that already is one. */
export function normaliseSourceOrdering(value: unknown): SourceOrdering {
  const d = defaultSourceOrdering
  if (!isObject(value)) return d
  const f = isObject(value.filters) ? value.filters : {}
  const a = isObject(value.appearance) ? value.appearance : {}
  const pick = <T,>(valid: (x: unknown) => x is T, x: unknown, fallback: T): T => (valid(x) ? x : fallback)

  // Every category appears exactly once; ones the saved list leaves out follow in their default places.
  const saved = Array.isArray(value.categoryOrder) ? value.categoryOrder.filter(isCategory) : []
  const categoryOrder = [...new Set([...saved, ...sourceCategories])]
  const providerOrder: SourceOrdering['providerOrder'] = {}
  if (isObject(value.providerOrder)) for (const [k, ids] of Object.entries(value.providerOrder)) if (isCategory(k) && isStrings(ids)) providerOrder[k] = [...new Set(ids)]

  // A saved list of rules is kept as it is, even when empty (the viewer removed them all), without repeats.
  const rules: SourceSortRule[] = []
  if (Array.isArray(value.sortRules)) {
    for (const r of value.sortRules) if (isObject(r) && isSortKey(r.key) && !rules.some((x) => x.key === r.key)) rules.push({ key: r.key, descending: r.descending !== false })
  }
  const badge = a.badges ?? a.badgePack
  return {
    useCustomOrdering: pick(isBool, value.useCustomOrdering, d.useCustomOrdering),
    categoryOrder,
    providerOrder,
    sortRules: Array.isArray(value.sortRules) ? rules : defaultSortRules(),
    filters: {
      excludeCinemaCaptures: pick(isBool, f.excludeCinemaCaptures, d.filters.excludeCinemaCaptures),
      excludeUncached: pick(isBool, f.excludeUncached, d.filters.excludeUncached),
      minSizeGB: limit(f.minSizeGB),
      maxSizeGB: limit(f.maxSizeGB),
      minResolution: pick(isResolution, f.minResolution, 0),
      requiredKeywords: isStrings(f.requiredKeywords) ? f.requiredKeywords : [],
      excludedKeywords: isStrings(f.excludedKeywords) ? f.excludedKeywords : [],
      preferredLanguages: isStrings(f.preferredLanguages) ? f.preferredLanguages : [],
      excludedCodecs: isStrings(f.excludedCodecs) ? f.excludedCodecs : [],
    },
    resultCap: limit(value.resultCap),
    appearance: {
      showRawText: pick(isBool, a.showRawText, d.appearance.showRawText),
      titleDisplay: pick(isTitleDisplay, a.titleDisplay, d.appearance.titleDisplay),
      badges: badge === 'minimal' || badge === 'none' ? badge : 'all',
      showSize: pick(isBool, a.showSize, d.appearance.showSize),
      compact: pick(isBool, a.compact, d.appearance.compact),
    },
  }
}
