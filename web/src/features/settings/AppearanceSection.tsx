import { settingsStore, useSettings } from '../../lib/store/settings'
import { orderTabs } from '../../lib/tabs'
import { startPath } from '../../lib/startTab'
import { Group, Row, Select } from './controls'
import { TabOrderGroup } from './TabOrderGroup'
import { TitlePagesGroup } from './TitlePagesGroup'

/** What shapes the pages and where the site opens. Light and dark is one tap in the top bar, so it isn't repeated here. */
export function AppearanceSection() {
  return (
    <>
      <TitlePagesGroup />
      <OpeningTab />
      <TabOrderGroup />
    </>
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
