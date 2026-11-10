import s from './Notices.module.css'

/* A one-line note that fades after a few seconds, for a menu action that has no page of its own to say it worked
   ("Link copied"). It sits where the app's other notes do and is read out politely. */

let current: { stack: HTMLElement; timer: number } | undefined

export function flash(text: string, ms = 3200) {
  if (current) {
    window.clearTimeout(current.timer)
    current.stack.remove()
  }
  const stack = document.createElement('div')
  stack.className = s.stack ?? ''
  stack.setAttribute('role', 'status')
  // Over a sheet too (the source picker is 100): the note is about what was just pressed there.
  stack.style.zIndex = '130'
  const note = document.createElement('p')
  note.className = s.note ?? ''
  stack.append(note)
  document.body.append(stack)
  // A live region is only read when its text arrives after it is in the page.
  requestAnimationFrame(() => (note.textContent = text))
  const timer = window.setTimeout(() => {
    stack.remove()
    if (current?.stack === stack) current = undefined
  }, ms)
  current = { stack, timer }
}
