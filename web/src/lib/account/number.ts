/* The account number (docs/SYNC.md, Marquee Accounts): 16 digits from the browser's CSPRNG, shown in groups of
   four, read back ignoring spaces and dashes. Pure text handling, so it is tested without a browser. */

export const numberLength = 16

/** Why a typed number was refused, in the words the apps use too. */
export const incompleteNumber = 'That account number isn’t complete. It is 16 digits.'

/** A fresh account number: 16 digits, each uniform over 0 to 9. A random byte below 250 maps to a digit by its
 *  remainder; the 6 values above are thrown away, since keeping them would make 0 to 5 slightly likelier (modulo bias). */
export function makeNumber(random: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => void crypto.getRandomValues(b)): string {
  let digits = ''
  while (digits.length < numberLength) {
    const bytes = new Uint8Array(32)
    random(bytes)
    for (const byte of bytes) {
      if (byte < 250 && digits.length < numberLength) digits += String(byte % 10)
    }
  }
  return digits
}

/** `1234 5678 9012 3456`: the form shown and copied. Takes any amount of digits, for a field that formats as you type. */
export const groupNumber = (digits: string) => digits.match(/.{1,4}/g)?.join(' ') ?? ''

/** What a field holds while typing: digits only, at most 16, grouped by four. Letters and punctuation are dropped, so
 *  pasting `1234-5678-9012-3456` or ` 1234 5678 9012 3456 ` gives the same text. */
export const formatTyped = (input: string) => groupNumber(input.replace(/\D/g, '').slice(0, numberLength))

/** The 16 digits of what a person typed or pasted (spaces, dashes and other separators ignored), or null unless there are exactly 16. */
export function parseNumber(input: string): string | null {
  const digits = input.replace(/[\s\-–—.]/g, '')
  return /^\d{16}$/.test(digits) ? digits : null
}
