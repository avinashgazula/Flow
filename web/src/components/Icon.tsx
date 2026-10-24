/* A small, hand-drawn icon set in the spirit of SF Symbols: 24-unit grid, round caps, drawn with
   currentColor so icons take the text colour around them. Inline SVG: no requests, no font. */

const paths = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  explore: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  library: 'M5 4v16M9.5 4v16M14 5l4.5 14.5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
  settings: 'M18.93 9.39 L21.39 10.00 L21.39 14.00 L18.93 14.61 L18.74 15.05 L20.05 17.22 L17.22 20.05 L15.05 18.74 L14.61 18.93 L14.00 21.39 L10.00 21.39 L9.39 18.93 L8.95 18.74 L6.78 20.05 L3.95 17.22 L5.26 15.05 L5.07 14.61 L2.61 14.00 L2.61 10.00 L5.07 9.39 L5.26 8.95 L3.95 6.78 L6.78 3.95 L8.95 5.26 L9.39 5.07 L10.00 2.61 L14.00 2.61 L14.61 5.07 L15.05 5.26 L17.22 3.95 L20.05 6.78 L18.74 8.95Z M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  play: 'M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z',
  pause: 'M7 4.5h3.2v15H7zM13.8 4.5H17v15h-3.2z',
  skipForward: 'M4.5 5.3v13.4a.8.8 0 0 0 1.25.66l9.5-6.7a.8.8 0 0 0 0-1.32l-9.5-6.7A.8.8 0 0 0 4.5 5.3zM17.5 5h2.3v14h-2.3z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5 10 17.5 19 7',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z',
  chevronRight: 'M9.5 5.5 16 12l-6.5 6.5',
  chevronLeft: 'M14.5 5.5 8 12l6.5 6.5',
  chevronDown: 'M5.5 9.5 12 16l6.5-6.5',
  close: 'M6 6l12 12M18 6 6 18',
  star: 'm12 3.8 2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8z',
  share: 'M12 15V4M8 7.5 12 3.5l4 4M6 11v8.5h12V11',
  trailer: 'M4 6.5h16v11H4zM10.5 9.5v5l4-2.5z',
  tv: 'M4 6h16v10.5H4zM9 20h6M12 16.5V20',
  person: 'M12 12a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6zM5 20a7 7 0 0 1 14 0',
  back10: 'M11 6.5H7.5V3M7.7 6.4A7.5 7.5 0 1 1 5 12',
  forward10: 'M13 6.5h3.5V3M16.3 6.4A7.5 7.5 0 1 0 19 12',
  volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  exitFullscreen: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  pip: 'M3.5 5.5h17v13h-17zM12.5 12h6v4.5h-6z',
  subtitles: 'M3.5 5.5h17v13h-17zM7 13.5h4M13 13.5h4M7 10h10',
  text: 'M5 6.5V5h14v1.5M12 5v14.5M9 19.5h6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6v.2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  live: 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 18.7a9.5 9.5 0 0 1 0-13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4',
  server: 'M4.5 4.5h15v6h-15zM4.5 13.5h15v6h-15zM8 7.5h.1M8 16.5h.1',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13',
  calendar: 'M4.5 6h15v14h-15zM4.5 10.5h15M8.5 3.5v4M15.5 3.5v4',
  history: 'M12 21a9 9 0 1 0-9-9M3 12V7.5M3 12h4.5M12 7.5V12l3 2',
  download: 'M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14',
  bookmark: 'M7 3.5h10a1 1 0 0 1 1 1V20l-6-4.2L6 20V4.5a1 1 0 0 1 1-1z',
  airplay: 'M6.5 17h-2V5.5h15V17h-2M12 14.5 16.5 20h-9z',
  cast: 'M3.5 9V5.5h17v13H14M3.5 12.5a6.5 6.5 0 0 1 6.5 6.5M3.5 16a3 3 0 0 1 3 3',
  music: 'M9 17.5V6l10-2v11.5M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  stack: 'M12 4 3.5 8.5 12 13l8.5-4.5zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5',
  gauge: 'M4.6 17.5a8.5 8.5 0 1 1 14.8 0M12 14l3.8-4.2',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.2M12 17v.2',
  sparkles: 'M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.5l-1.6-5.3L5 10.6 10.4 9zM18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5V8.5h-4',
  filters: 'M4 8h8.5M17.5 8H20M15 5.5v5M4 16h2.5M11.5 16H20M9 13.5v5',
  warning: 'M12 4.2 20.8 19.5H3.2zM12 10v4.2M12 16.9v.1',
  chevronUp: 'M5.5 14.5 12 8l6.5 6.5',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14',
  list: 'M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.2 6.5h.1M4.2 12h.1M4.2 17.5h.1',
  copy: 'M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 20, strokeWidth = 2, filled, className }: { name: IconName; size?: number; strokeWidth?: number; filled?: boolean; className?: string }) {
  const solid = filled ?? (name === 'play' || name === 'pause' || name === 'star' || name === 'skipForward')
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={solid ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}
