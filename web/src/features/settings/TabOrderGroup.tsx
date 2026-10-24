import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { defaultTabOrder, isDefaultOrder, moveTab, orderTabs, tabs as defaultTabs } from '../../lib/tabs'
import { Group, Row } from './controls'
import s from './SettingsScreen.module.css'

type Direction = -1 | 1

/** The order of the top bar and the phone's tab bar, with up and down buttons as the add-ons list has: they
 *  work with a keyboard, a screen reader and a thumb alike, where dragging works with one of them. */
export function TabOrderGroup() {
  const saved = useSettings((x) => x.tabOrder)
  const tabs = orderTabs(saved)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const refocus = useRef<{ id: string; direction: Direction } | null>(null)
  const [said, setSaid] = useState('')

  // A moved row is the same element in a new place, which some browsers treat as losing focus. Give it back to
  // the button that was pressed, or to its opposite when the row has reached an end and that one is disabled.
  useEffect(() => {
    const next = refocus.current
    refocus.current = null
    if (!next) return
    const press = buttons.current.get(`${next.id}:${next.direction}`)
    const other = buttons.current.get(`${next.id}:${-next.direction}`)
    ;(press && !press.disabled ? press : other)?.focus()
  }, [saved])

  function move(id: string, direction: Direction) {
    const order = moveTab(saved, id, direction)
    settingsStore.set({ tabOrder: order })
    refocus.current = { id, direction }
    const label = tabs.find((t) => t.id === id)?.label ?? id
    setSaid(`${label} is now ${order.indexOf(id) + 1} of ${order.length}.`)
  }

  const names = defaultTabs.map((t) => t.label).join(', ')
  return (
    <>
      <Group title="Tab Order" footer="Sets the order of the bar at the top and of the tabs along the bottom of a phone.">
        {tabs.map((tab, i) => (
          <Row
            key={tab.id}
            label={
              <span className={s.tabName}>
                <Icon name={tab.icon} size={20} strokeWidth={2} filled={false} />
                {tab.label}
              </span>
            }
          >
            <button
              ref={(el) => void (el ? buttons.current.set(`${tab.id}:-1`, el) : buttons.current.delete(`${tab.id}:-1`))}
              type="button"
              className="btn btn-secondary btn-circle btn-compact"
              onClick={() => move(tab.id, -1)}
              disabled={i === 0}
              aria-label={`Move ${tab.label} up`}
            >
              <Icon name="chevronUp" size={16} strokeWidth={2.4} />
            </button>
            <button
              ref={(el) => void (el ? buttons.current.set(`${tab.id}:1`, el) : buttons.current.delete(`${tab.id}:1`))}
              type="button"
              className="btn btn-secondary btn-circle btn-compact"
              onClick={() => move(tab.id, 1)}
              disabled={i === tabs.length - 1}
              aria-label={`Move ${tab.label} down`}
            >
              <Icon name="chevronDown" size={16} strokeWidth={2.4} />
            </button>
          </Row>
        ))}
        <Row label="Default Order" detail={names}>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            disabled={isDefaultOrder(saved)}
            onClick={() => {
              settingsStore.set({ tabOrder: [...defaultTabOrder] })
              setSaid('Tab order reset.')
            }}
          >
            Reset
          </button>
        </Row>
      </Group>
      <p className="sr-only" role="status">
        {said}
      </p>
    </>
  )
}
