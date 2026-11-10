/* Share Setup's QR code, as the apps draw it: the same flow://setup link, shown only when it is small enough for a
   scanner to read. A QR holds under 3 KB at its lowest error correction, and a setup with many shelves and add-ons can
   be larger than that; then the file or the link is the way to share it. */

/** The longest link the apps draw as a code (Share Setup, DataSettingsViews.swift). */
export const qrLimit = 2800

export const fitsQR = (link: string) => link.length > 0 && link.length < qrLimit

export const tooLargeForQR = 'Your setup is too large for a QR code. Share the file or the link instead.'
