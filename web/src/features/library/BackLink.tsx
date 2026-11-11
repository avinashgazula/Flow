import { Link } from '@tanstack/react-router'
import { Icon } from '../../components/Icon'

/** The way back from a list or a page to Library's overview, above the title. */
export function BackLink() {
  return (
    <Link to="/library">
      <Icon name="chevronLeft" size={16} strokeWidth={2.6} /> Library
    </Link>
  )
}
