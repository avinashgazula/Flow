import { ffmpeg, libraries, typefaces } from '../../lib/licences'
import { Group, Row } from './controls'

/* Open Source Licences: what the website is built from, under which licence, and where the source is. FFmpeg's decoders
   and libass are LGPL, which asks for the licence text, a way to the source and a way to swap the library; this is it.
   It loads when About's row is opened, so none of it is in the first page. */

const link = (href: string, label: string) => (
  <a href={href} target="_blank" rel="noreferrer">
    {label}
  </a>
)

export function Licences() {
  const base = import.meta.env.BASE_URL
  const fonts = `${base}fonts/`
  return (
    <>
      <Group title="FFmpeg" footer="Marquee plays Dolby Digital, DTS and Dolby TrueHD by decoding them with FFmpeg’s libavcodec and libavutil, built to a WebAssembly file of their own (flow-audio.wasm). No GPL or non-free part is enabled. The file loads separately from the page, so a version built from changed source can take its place: the notice beside it says how.">
        <Row label="FFmpeg" detail={`Version ${ffmpeg.version} · LGPL-2.1-or-later`}>
          {link(ffmpeg.home, 'ffmpeg.org')}
        </Row>
        <Row label="Source" detail="The release this module is built from">
          {link(ffmpeg.source, 'Download')}
        </Row>
        <Row label="Build Script and Notice" detail="How it is built, and how to replace it">
          {link(ffmpeg.script, 'Script')} {link(ffmpeg.notice, 'Notice')}
        </Row>
        <Row label="Licence Text" detail="GNU Lesser General Public License 2.1">
          {link(`${base}licences/COPYING.LGPLv2.1.txt`, 'Read')}
        </Row>
      </Group>
      <Group title="Libraries" footer="Everything the pages bundle, as installed. JASSUB carries libass, FreeType, HarfBuzz, FriBidi and more as WebAssembly; its own licence file lists them. Marquee itself is MIT licensed.">
        {libraries.map((lib) => (
          <Row key={lib.package} label={lib.name} detail={`${lib.version} · ${lib.licence} · ${lib.use}`}>
            {link(lib.url, 'Source')}
          </Row>
        ))}
      </Group>
      <Group title="Typefaces" footer="All under the SIL Open Font License 1.1, self-hosted: Marquee asks no font service for anything.">
        {typefaces.map((face) => (
          <Row key={face.name} label={face.name} detail="SIL OFL 1.1">
            {link(`${fonts}${face.file}`, 'Licence')}
          </Row>
        ))}
      </Group>
    </>
  )
}
