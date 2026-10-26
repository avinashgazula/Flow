import { describe, expect, it } from 'vitest'
import { createReporter, progressEveryMs, type Reading } from './report'
import type { ReportState } from './types'

function setup(failOn?: ReportState) {
  const sent: [ReportState, number, boolean][] = []
  const reporter = createReporter({
    async send(state, reading, keepalive) {
      sent.push([state, reading.position, keepalive])
      if (state === failOn) throw new Error('server down')
    },
  })
  return { sent, reporter }
}
const at = (position: number): Reading => ({ position, duration: 7200 })
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('telling a server what plays', () => {
  it('starts once, then reports progress at most every ten seconds', async () => {
    const { sent, reporter } = setup()
    reporter.playing(at(0), 0)
    reporter.tick(at(1), 1000)
    reporter.tick(at(9), 9000)
    reporter.tick(at(10), progressEveryMs)
    reporter.tick(at(15), 15_000)
    reporter.tick(at(21), 20_001)
    await settle()
    expect(sent).toEqual([
      ['started', 0, false],
      ['progress', 10, false],
      ['progress', 21, false],
    ])
  })

  it('says paused, and progress (not a second start) when it plays again', async () => {
    const { sent, reporter } = setup()
    reporter.playing(at(0), 0)
    reporter.pause(at(30), 30_000)
    reporter.playing(at(30), 60_000)
    await settle()
    expect(sent.map((s) => s[0])).toEqual(['started', 'paused', 'progress'])
  })

  it('says nothing before it has started, and stops once', async () => {
    const { sent, reporter } = setup()
    reporter.tick(at(5), 50_000)
    reporter.pause(at(5), 50_000)
    reporter.stop(at(5))
    expect(sent).toEqual([])
    reporter.playing(at(1), 0)
    reporter.stop(at(100), true)
    reporter.stop(at(200), true)
    reporter.tick(at(300), 999_999)
    reporter.playing(at(300), 999_999)
    await settle()
    expect(sent).toEqual([
      ['started', 1, false],
      ['stopped', 100, true],
    ])
  })

  it('keeps its order when the network is slow, and carries on after a report fails', async () => {
    const { sent, reporter } = setup('progress')
    reporter.playing(at(0), 0)
    reporter.tick(at(11), 11_000)
    reporter.pause(at(12), 12_000)
    reporter.stop(at(13))
    await settle()
    await settle()
    expect(sent.map((s) => s[0])).toEqual(['started', 'progress', 'paused', 'stopped'])
  })
})
