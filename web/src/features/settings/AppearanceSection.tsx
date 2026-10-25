import { Icon } from '../../components/Icon'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { typefaces } from './options'
import { TabOrderGroup } from './TabOrderGroup'
import s from './SettingsScreen.module.css'

/** The typeface, as a group of cards that each show their own font. Native radio inputs give the
 *  group its keyboard behaviour: Tab lands on the chosen card, the arrow keys move and choose. */
export function AppearanceSection() {
  // A value saved by a newer build that this one doesn't know reads as System, which is what shows.
  const saved = useSettings((x) => x.font)
  const font = typefaces.some((f) => f.value === saved) ? saved : 'system'

  return (
    <>
      <div className={s.groupWrap}>
        <h3 id="typeface-title" className={s.groupTitle}>
          Typeface
        </h3>
        <div role="radiogroup" aria-labelledby="typeface-title" className={s.faces}>
          {typefaces.map((f) => (
            <label key={f.value} className={s.face} data-selected={font === f.value ? '' : undefined}>
              <input
                type="radio"
                name="typeface"
                className="sr-only"
                value={f.value}
                checked={font === f.value}
                onChange={() => settingsStore.set({ font: f.value })}
                aria-labelledby={`face-${f.value}-name`}
                aria-describedby={`face-${f.value}-detail`}
              />
              {/* The sample sets itself in this card's font, whatever the page is set in. */}
              <span className={s.sample} data-font={f.value} aria-hidden="true">
                <span className={s.sampleTitle}>Dune: Part Two</span>
                {/* The no-break space keeps the dot with the sentence when the digits wrap. */}
                <span className={s.sampleText}>The quick brown fox jumps over the lazy dog&nbsp;· 0123456789</span>
              </span>
              <span className={s.faceText}>
                <span id={`face-${f.value}-name`} className={s.faceName}>
                  {f.label}
                </span>
                <span id={`face-${f.value}-detail`} className={s.faceDetail}>
                  {f.detail}
                </span>
              </span>
              <span className={s.faceCheck} aria-hidden="true">
                <Icon name="check" size={14} strokeWidth={3} />
              </span>
            </label>
          ))}
        </div>
        <p className={s.footer}>Applies right away. Any typeface other than System downloads once, when you choose it.</p>
      </div>
      <TabOrderGroup />
    </>
  )
}
