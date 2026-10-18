import { describe, expect, it } from 'vitest'
import { clock, episodeLine, languageName, trackLabel } from './format'
import { cueSegments, parseSubtitles, parseTimestamp } from './subtitles'

describe('parseTimestamp', () => {
  it('reads SRT, VTT and ASS times', () => {
    expect(parseTimestamp('00:01:02,345')).toBeCloseTo(62.345)
    expect(parseTimestamp('01:02.500')).toBeCloseTo(62.5)
    expect(parseTimestamp('0:01:02.34')).toBeCloseTo(62.34)
    expect(parseTimestamp('nope')).toBeNaN()
  })
})

describe('parseSubtitles', () => {
  it('reads SRT with a BOM, CRLF and multi-line cues', () => {
    const cues = parseSubtitles('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\nthere\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n', 'srt')
    expect(cues).toEqual([
      { start: 1, end: 2, text: 'Hello\nthere' },
      { start: 3, end: 4, text: 'Bye' },
    ])
  })
  it('ignores WebVTT headers, notes and cue settings', () => {
    const cues = parseSubtitles('WEBVTT\n\nNOTE x\n\ncue1\n00:01.000 --> 00:02.000 align:center line:85%\nHi\n', 'vtt')
    expect(cues).toEqual([{ start: 1, end: 2, text: 'Hi' }])
  })
  it('reads ASS dialogue, keeping italics and commas in the text', () => {
    const ass = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Well, hello{\\i0}\\Nthere\nDialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 10\n'
    expect(parseSubtitles(ass, 'ass')).toEqual([{ start: 1, end: 2.5, text: '<i>Well, hello</i>\nthere' }])
  })
})

describe('cueSegments', () => {
  it('keeps italics and bold, drops other tags, decodes entities', () => {
    expect(cueSegments('<i>Hi</i> <v Bob>you</v> &amp; <b>me</b>\nnext')).toEqual([
      [{ text: 'Hi', italic: true }, { text: ' ' }, { text: 'you' }, { text: ' & ' }, { text: 'me', bold: true }],
      [{ text: 'next' }],
    ])
  })
})

describe('format', () => {
  it('clocks', () => {
    expect(clock(245)).toBe('4:05')
    expect(clock(3733)).toBe('1:02:13')
    expect(clock(-3)).toBe('0:00')
  })
  it('names episodes and tracks', () => {
    expect(episodeLine(1, 2, 'Pilot')).toBe('S1 E2 · Pilot')
    expect(episodeLine(1, 2)).toBe('S1 E2')
    expect(languageName('eng')).toBe('English')
    expect(languageName('und')).toBeUndefined()
    expect(trackLabel({ name: 'Track 2', language: 'fr', channels: 6 })).toBe('French · 5.1')
    expect(trackLabel({ name: 'Commentary', language: 'en', forced: true })).toBe('Commentary (Forced)')
  })
})
