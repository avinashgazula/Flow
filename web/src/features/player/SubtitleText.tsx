import { Fragment } from 'react'
import { type Segment } from './subtitles'
import s from './SubtitleText.module.css'

/** The lines of a subtitle as the viewer styled them. Text only: the cue's own markup has already been
 *  reduced to italic and bold runs, and nothing here is ever set as HTML. */
export function SubtitleLines({ lines }: { lines: Segment[][] }) {
  return lines.map((line, i) => (
    <span key={i} className={s.line}>
      <span className={s.box}>
        {line.map((seg, j) => {
          const content = seg.bold ? <b>{seg.text}</b> : seg.text
          return <Fragment key={j}>{seg.italic ? <i>{content}</i> : content}</Fragment>
        })}
      </span>
    </span>
  ))
}

/** Plain lines of text as segments, for the sample the preview and the style page show. */
export const plainLines = (text: readonly string[]): Segment[][] => text.map((t) => [{ text: t }])
