import {
  AlertTriangle,
  AudioLines,
  Cast,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Gauge,
  History,
  Info,
  ListMusic,
  ListVideo,
  Layers,
  Maximize,
  Minimize,
  Minus,
  Moon,
  PictureInPicture2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  ScanFace,
  Search,
  Settings,
  SkipForward,
  Type,
  Volume2,
  VolumeX,
  X,
  Airplay,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'
import type { ReactNode } from 'react'

/* The player's icons are Lucide (ISC), one family at one stroke width, imported by name so only these ship, in the player's
   chunk. Names keep the site icon set's spelling where the drawing means the same thing. */
const icons = {
  close: X,
  back: ChevronLeft,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  check: Check,
  plus: Plus,
  minus: Minus,
  play: Play,
  pause: Pause,
  volume: Volume2,
  mute: VolumeX,
  fullscreen: Maximize,
  exitFullscreen: Minimize,
  pip: PictureInPicture2,
  cast: Cast,
  airplay: Airplay,
  settings: Settings,
  /** Audio and Subtitles. */
  subtitles: Captions,
  /** Episodes. */
  episodes: ListVideo,
  xray: ScanFace,
  external: ExternalLink,
  search: Search,
  text: Type,
  clock: Clock,
  music: AudioLines,
  list: ListMusic,
  stack: Layers,
  gauge: Gauge,
  moon: Moon,
  replay: History,
  history: History,
  info: Info,
  warning: AlertTriangle,
  alert: AlertTriangle,
  skipForward: SkipForward,
} satisfies Record<string, LucideIcon>

export type PlayerIconName = keyof typeof icons

/** The player's stroke width, the same on every icon so the row reads as one set. */
export const iconStroke = 1.75

export function PlayerIcon({ name, size = 24, strokeWidth = iconStroke, className }: { name: PlayerIconName; size?: number; strokeWidth?: number; className?: string }) {
  const Glyph = icons[name]
  return <Glyph size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" focusable="false" />
}

/** The go-back and go-forward arrows with the seconds inside (10 unless set). */
export function SkipGlyph({ forward, size = 24, seconds = 10 }: { forward: boolean; size?: number; seconds?: number }) {
  const Arrow: (p: LucideProps & { children?: ReactNode }) => ReactNode = forward ? RotateCw : RotateCcw
  return (
    <Arrow size={size} strokeWidth={iconStroke} aria-hidden="true" focusable="false">
      <text x="12" y="15.4" textAnchor="middle" fontSize="7.4" fontWeight="700" fill="currentColor" stroke="none" fontFamily="-apple-system, system-ui, sans-serif">
        {seconds}
      </text>
    </Arrow>
  )
}
