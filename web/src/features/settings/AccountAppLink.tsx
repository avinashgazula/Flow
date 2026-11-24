import { useEffect, useState, useSyncExternalStore } from 'react'
import { loadConfig } from '../../lib/account/config'
import { accountStatus } from '../../lib/account/engine'
import { accountLink } from '../../lib/account/link'
import { Group, Row } from './controls'
import s from './SettingsScreen.module.css'
import { QRCode } from './SyncGroup'

/* Settings → Account → Use This Account in the App. A link and a QR code that log the Apple apps in to this account in one
   step (docs/SYNC.md, The account link). The number is the account's key, so the link is built only while it is shown:
   it is never in the page address, the history or a log, and hiding it, leaving the page or logging out removes it. */

export function AppLinkGroup() {
  const status = useSyncExternalStore(accountStatus.subscribe, accountStatus.get)
  const [shown, setShown] = useState(false)
  // The server this browser logged in on, which is the one the apps must use too.
  const config = status.phase === 'off' ? null : loadConfig()
  const number = config?.number ?? ''
  const server = config?.server ?? ''
  // The link is made from what this browser holds at the moment it is shown, and is null for anything the apps couldn't use.
  const link = shown && number ? accountLink(number, server) : null
  // Logging out hides it again, so the next account starts closed.
  useEffect(() => {
    if (!number) setShown(false)
  }, [number])
  if (!number) return null
  return (
    <Group title="Use This Account in the App" footer="On your iPhone, iPad or Mac, scan the code with the camera or open the link there, and Marquee logs in to this account. On Apple TV, log in from its Settings with the account number.">
      <Row label="Link for the Apps" detail={shown ? 'Anyone with this link can open your account, so don’t share it' : 'Hidden until you ask for it'}>
        <button type="button" className="btn btn-secondary btn-compact" aria-pressed={shown} onClick={() => setShown((v) => !v)}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </Row>
      {shown && !link && (
        <p className={`${s.hint} ${s.pad}`} role="alert">
          Marquee can’t make a link from this account’s server address. Log out and log in again with the address of your Worker, then try again.
        </p>
      )}
      {link && (
        <div className={s.pairing}>
          <p className={s.hint}>This link holds your account number. Open it on a device that has Marquee, or scan the code with its camera.</p>
          <div className={s.pairingBody}>
            <QRCode text={link} label="QR code that logs the app in to this account" />
            <a className="btn btn-primary btn-compact" href={link} data-account-app-link="">
              Open in Marquee
            </a>
          </div>
        </div>
      )}
    </Group>
  )
}
