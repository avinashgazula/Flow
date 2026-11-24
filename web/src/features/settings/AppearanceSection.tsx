import { Icon } from '../../components/Icon'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { orderTabs } from '../../lib/tabs'
import { startPath } from '../../lib/startTab'
import { resolvePalette } from '../../lib/palette'
import { useTheme } from '../../lib/theme'
import { resolveTypeface } from '../../lib/typeface'
import { Group, Row, Select } from './controls'
import { palettes, typefaces } from './options'
import { TabOrderGroup } from './TabOrderGroup'
import { TitlePagesGroup } from './TitlePagesGroup'
import s from './SettingsScreen.module.css'

/** What shapes the pages and where the site opens. Light and dark is one tap in the top bar, so it isn't repeated here: Theme
 *  is the colours, and each has both sides. */
export function AppearanceSection() {
  return (
    <>
      <ThemeGroup />
      <TypefaceGroup />
      <TitlePagesGroup />
      <OpeningTab />
      <TabOrderGroup />
    </>
  )
}

/** The colour theme, as a list of rows that each show their own four colours (paper, ink, mark, action) on the side now
 *  showing, light or dark. Native radio inputs give the group its keyboard behaviour, as the typeface's do. */
function ThemeGroup() {
  const palette = resolvePalette(useSettings((x) => x.palette))
  const side = useTheme()
  return (
    <Group title="Theme" footer="Applies right away. Every theme has a light and a dark side; the Light and Dark cell in the top bar picks between them.">
      <div role="radiogroup" aria-label="Theme" className={s.faces}>
        {palettes.map((p) => (
          <label key={p.value} className={s.face} data-selected={palette === p.value ? '' : undefined} data-settings-row="">
            <input
              type="radio"
              name="palette"
              className="sr-only"
              value={p.value}
              checked={palette === p.value}
              onChange={() => settingsStore.set({ palette: p.value })}
              aria-labelledby={`palette-${p.value}-name`}
              aria-describedby={`palette-${p.value}-detail`}
            />
            <span className={s.paletteSample}>
              {/* The strip takes the theme's own colours, whichever theme is showing; the row's text keeps the page's. */}
              <span className={s.swatch} data-swatch={`${p.value}-${side}`} aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
              <span id={`palette-${p.value}-name`} className={s.faceName} data-row-label="">
                {p.label}
              </span>
            </span>
            <span id={`palette-${p.value}-detail`} className={s.faceDetail} data-row-detail="">
              {p.detail}
            </span>
            <span className={s.faceCheck} aria-hidden="true">
              <Icon name="check" size={16} strokeWidth={3} />
            </span>
          </label>
        ))}
      </div>
    </Group>
  )
}

/** The typeface of the interface and body text, as a list of rows that each show their own face. Native radio inputs give
 *  the group its keyboard behaviour: Tab lands on the chosen row, the arrow keys move and choose. */
function TypefaceGroup() {
  // A value an older or newer build saved reads as the face it stands for (Ioskeley Mono is Mono now), else System.
  const font = resolveTypeface(useSettings((x) => x.font))
  return (
    <Group title="Typeface" footer="Applies right away. Titles, headings, reading text and the small labels keep their own faces. Any typeface other than System downloads once, when you choose it.">
      <div role="radiogroup" aria-label="Typeface" className={s.faces}>
        {typefaces.map((f) => (
          <label key={f.value} className={s.face} data-selected={font === f.value ? '' : undefined} data-settings-row="">
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
            {/* The name and the sample set themselves in this row's face, whatever the page is set in. */}
            <span className={s.faceSample} data-font={f.value}>
              <span id={`face-${f.value}-name`} className={s.faceName} data-row-label="">
                {f.label}
              </span>
              <span className={s.faceText} aria-hidden="true">
                The quick brown fox jumps over the lazy dog&nbsp;· 0123456789
              </span>
            </span>
            <span id={`face-${f.value}-detail`} className={s.faceDetail} data-row-detail="">
              {f.detail}
            </span>
            <span className={s.faceCheck} aria-hidden="true">
              <Icon name="check" size={16} strokeWidth={3} />
            </span>
          </label>
        ))}
      </div>
    </Group>
  )
}

/** Where the site opens from its front address, as the apps' Opening Tab. The choices follow the tab order. */
function OpeningTab() {
  const saved = useSettings((x) => x.startTab)
  const order = useSettings((x) => x.tabOrder)
  const current = orderTabs(order).find((t) => t.to === startPath(saved)) ?? orderTabs(order)[0]!
  return (
    <Group title="Navigation" footer="Opening Tab is where Marquee opens when you go to its front address. Links to a title, a search or a sign-in open where they point.">
      <Row label="Opening Tab" htmlFor="opening-tab">
        <Select id="opening-tab" label="Opening Tab" value={current.id} onChange={(id) => settingsStore.set({ startTab: id })} options={orderTabs(order).map((t) => ({ value: t.id, label: t.label }))} />
      </Row>
    </Group>
  )
}
