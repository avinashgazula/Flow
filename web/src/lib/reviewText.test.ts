import { describe, expect, it } from 'vitest'
import { cleanReview, compactMoney, decodeEntities, spoilerParts } from './reviewText'

/* The cases are FlowKit's ReviewTextTests and CompactMoney tests, so the page and the apps read a review the same. */
describe('cleanReview', () => {
  it('decodes entities and keeps the ones it does not know', () => {
    expect(cleanReview('plot &amp; save the world')).toBe('plot & save the world')
    expect(cleanReview('&quot;Wow&quot; &#39;yes&#39; &#x2014; it&rsquo;s')).toBe('"Wow" \'yes\' — it’s')
    expect(cleanReview('Tom & Jerry &unknown; &')).toBe('Tom & Jerry &unknown; &')
  })

  it('turns tags into line breaks or nothing, and caps blank lines', () => {
    expect(cleanReview('<em>Great</em> film.<br/>Second line<br><br><br><br>Last')).toBe('Great film.\nSecond line\n\nLast')
  })

  it('keeps the words of Markdown', () => {
    expect(cleanReview('**Bold** and _quiet_ and *soft*')).toBe('Bold and quiet and soft')
    expect(cleanReview('Read [my blog](https://example.com/post) now')).toBe('Read my blog now')
  })

  it('leaves ordinary text alone', () => {
    expect(cleanReview('snake_case_names, 2 * 3 * 4, a < b')).toBe('snake_case_names, 2 * 3 * 4, a < b')
    expect(cleanReview('[spoiler]He dies[/spoiler]')).toBe('[spoiler]He dies[/spoiler]')
  })

  it('does not decode an entity that is not a character', () => {
    expect(decodeEntities('&#0; &#xD800; &#99999999;')).toBe('&#0; &#xD800; &#99999999;')
  })
})

describe('spoilerParts', () => {
  it('marks what sits inside the tags', () => {
    expect(spoilerParts('Loved it. [spoiler]He dies.[/spoiler] Go see it.')).toEqual([
      { text: 'Loved it. ', spoiler: false },
      { text: 'He dies.', spoiler: true },
      { text: ' Go see it.', spoiler: false },
    ])
  })

  it('hides the rest after a tag that is never closed', () => {
    expect(spoilerParts('Fine so far. [SPOILER]The twist is')).toEqual([
      { text: 'Fine so far. ', spoiler: false },
      { text: 'The twist is', spoiler: true },
    ])
  })

  it('returns plain text as one part', () => {
    expect(spoilerParts('No tags here.')).toEqual([{ text: 'No tags here.', spoiler: false }])
  })
})

describe('compactMoney', () => {
  it('prints dollars the way the apps do', () => {
    expect(compactMoney(80_000_000)).toBe('$80M')
    expect(compactMoney(120_400_000)).toBe('$120.4M')
    expect(compactMoney(2_500_000_000)).toBe('$2.5B')
    expect(compactMoney(450_000)).toBe('$450K')
    expect(compactMoney(900)).toBe('$900')
  })
})
