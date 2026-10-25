import { Icon, type IconName } from '../../components/Icon'

/* The drawings only the player uses, kept out of components/Icon.tsx so a first visit doesn't carry them. */
const paths = {
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z',
  replay: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.8h4.8M10 11h5M10 14.5h3',
  external: 'M13.5 4.5h6v6M19.5 4.5l-8 8M17 14v5.5H4.5V7H10',
  minus: 'M5 12h14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
} as const

export type PlayerIconName = keyof typeof paths

/** A site icon or one of the player's own, drawn the same way. */
export function PlayerIcon({ name, size = 20, strokeWidth = 2 }: { name: IconName | PlayerIconName; size?: number; strokeWidth?: number }) {
  if (!(name in paths)) return <Icon name={name as IconName} size={size} strokeWidth={strokeWidth} />
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name as PlayerIconName]} />
    </svg>
  )
}
