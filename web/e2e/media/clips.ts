/* The clips the playback matrix plays (made by scripts/e2e-media-fixtures.sh), with what each one holds and the release
   name an add-on would give it. The names say what is truly in the file, as a real release does, because ranking and
   routing read them: "DD5.1" in an MP4 sends it to the FFmpeg engine in a browser with no Dolby Digital decoder. */

export interface Clip {
  /** A short id for the test title. */
  id: string
  /** The file in e2e/media/generated. */
  file: string
  /** The release name the add-on offers it as. */
  release: string
  container: string
  video: string
  /** One entry per sound track, in file order. Track n is a tone at 440, 660, 880 Hz. */
  audio: string[]
  /** The address the host serves it at, when that should hide what it is (the debrid-link case). */
  path?: string
}

export const tones = [440, 660, 880] as const

const clip = (id: string, file: string, release: string, container: string, video: string, ...audio: string[]): Clip => ({ id, file, release, container, video, audio })

/** MP4, MOV and WebM: what a browser opens by itself. */
export const native: Clip[] = [
  clip('mp4 · H.264 · AAC', 'n-mp4-h264-aac.mp4', 'Matrix.480p.WEB-DL.AAC.H264.mp4', 'mp4', 'H.264', 'AAC'),
  clip('mov · H.264 · AAC', 'n-mov-h264-aac.mov', 'Matrix.480p.WEB-DL.AAC.H264.mov', 'mov', 'H.264', 'AAC'),
  clip('webm · VP9 · Opus', 'n-webm-vp9-opus.webm', 'Matrix.480p.WEB-DL.Opus.VP9.webm', 'webm', 'VP9', 'Opus'),
  clip('webm · VP8 · Vorbis', 'n-webm-vp8-vorbis.webm', 'Matrix.480p.WEB-DL.webm', 'webm', 'VP8', 'Vorbis'),
  clip('mp4 · AV1 · AAC', 'n-mp4-av1-aac.mp4', 'Matrix.480p.WEB-DL.AAC.AV1.mp4', 'mp4', 'AV1', 'AAC'),
  clip('mp4 · H.264 · Dolby Digital', 'n-mp4-h264-ac3.mp4', 'Matrix.480p.WEB-DL.DD5.1.H264.mp4', 'mp4', 'H.264', 'Dolby Digital'),
  clip('mp4 · H.264 · Dolby Digital Plus', 'n-mp4-h264-eac3.mp4', 'Matrix.480p.WEB-DL.DDP5.1.H264.mp4', 'mp4', 'H.264', 'Dolby Digital Plus'),
  clip('mp4 · HEVC · AAC', 'n-mp4-hevc-aac.mp4', 'Matrix.480p.WEB-DL.AAC.x265.mp4', 'mp4', 'HEVC', 'AAC'),
]

/** Matroska: the Rust remuxer, and the engine for sound it can't carry. */
export const matroska: Clip[] = [
  clip('mkv · H.264 · AAC', 'r-mkv-h264-aac.mkv', 'Matrix.480p.WEB-DL.AAC.H264.mkv', 'mkv', 'H.264', 'AAC'),
  clip('mkv · H.264 · Opus', 'r-mkv-h264-opus.mkv', 'Matrix.480p.WEB-DL.Opus.H264.mkv', 'mkv', 'H.264', 'Opus'),
  clip('mkv · H.264 · FLAC', 'r-mkv-h264-flac.mkv', 'Matrix.480p.WEB-DL.FLAC.H264.mkv', 'mkv', 'H.264', 'FLAC'),
  clip('mkv · H.264 · MP3', 'r-mkv-h264-mp3.mkv', 'Matrix.480p.WEB-DL.MP3.H264.mkv', 'mkv', 'H.264', 'MP3'),
  clip('mkv · VP9 · Opus', 'r-mkv-vp9-opus.mkv', 'Matrix.480p.WEB-DL.Opus.VP9.mkv', 'mkv', 'VP9', 'Opus'),
  clip('mkv · H.264 · Dolby Digital', 'r-mkv-h264-ac3.mkv', 'Matrix.480p.WEB-DL.DD5.1.H264.mkv', 'mkv', 'H.264', 'Dolby Digital'),
  clip('mkv · H.264 · Dolby Digital Plus', 'r-mkv-h264-eac3.mkv', 'Matrix.480p.WEB-DL.DDP5.1.H264.mkv', 'mkv', 'H.264', 'Dolby Digital Plus'),
  clip('mkv · H.264 · DTS', 'r-mkv-h264-dts.mkv', 'Matrix.480p.BluRay.DTS.H264.mkv', 'mkv', 'H.264', 'DTS'),
  clip('mkv · H.264 · TrueHD', 'r-mkv-h264-truehd.mkv', 'Matrix.480p.BluRay.TrueHD.H264.mkv', 'mkv', 'H.264', 'TrueHD'),
  clip('mkv · H.264 · Vorbis', 'r-mkv-h264-vorbis.mkv', 'Matrix.480p.WEB-DL.H264.mkv', 'mkv', 'H.264', 'Vorbis'),
  clip('mkv · H.264 · PCM', 'r-mkv-h264-pcm.mkv', 'Matrix.480p.WEB-DL.H264.mkv', 'mkv', 'H.264', 'PCM'),
  clip('mkv · H.264 · MP2', 'r-mkv-h264-mp2.mkv', 'Matrix.480p.WEB-DL.H264.mkv', 'mkv', 'H.264', 'MP2'),
  clip('mkv · H.264 · WMA', 'r-mkv-h264-wma.mkv', 'Matrix.480p.WEB-DL.H264.mkv', 'mkv', 'H.264', 'WMA'),
  clip('mkv · H.264 · AAC + Opus', 'r-mkv-h264-aac-opus.mkv', 'Matrix.480p.WEB-DL.AAC.Opus.H264.mkv', 'mkv', 'H.264', 'AAC', 'Opus'),
  clip('mkv · H.264 · AAC + Dolby Digital + DTS', 'r-mkv-h264-aac-ac3-dts.mkv', 'Matrix.480p.BluRay.AAC.DD5.1.DTS.H264.mkv', 'mkv', 'H.264', 'AAC', 'Dolby Digital', 'DTS'),
  clip('mkv · H.264 · Vorbis + PCM + MP2', 'r-mkv-h264-vorbis-pcm-mp2.mkv', 'Matrix.480p.WEB-DL.H264.mkv', 'mkv', 'H.264', 'Vorbis', 'PCM', 'MP2'),
]

/** Containers only the FFmpeg engine opens, with a picture the browser plays. */
export const universal: Clip[] = [
  clip('avi · H.264 · MP3', 'u-avi-h264-mp3.avi', 'Matrix.480p.WEB-DL.MP3.H264.avi', 'avi', 'H.264', 'MP3'),
  clip('avi · H.264 · MP3 + Dolby Digital', 'u-avi-h264-mp3-ac3.avi', 'Matrix.480p.WEB-DL.MP3.DD5.1.H264.avi', 'avi', 'H.264', 'MP3', 'Dolby Digital'),
  clip('ts · H.264 · AAC', 'u-ts-h264-aac.ts', 'Matrix.480p.HDTV.AAC.H264.ts', 'ts', 'H.264', 'AAC'),
  clip('ts · H.264 · Dolby Digital', 'u-ts-h264-ac3.ts', 'Matrix.480p.HDTV.DD5.1.H264.ts', 'ts', 'H.264', 'Dolby Digital'),
  clip('m2ts · H.264 · AAC', 'u-m2ts-h264-aac.m2ts', 'Matrix.480p.BluRay.AAC.H264.m2ts', 'm2ts', 'H.264', 'AAC'),
  clip('flv · H.264 · AAC', 'u-flv-h264-aac.flv', 'Matrix.480p.WEB-DL.AAC.H264.flv', 'flv', 'H.264', 'AAC'),
  clip('3gp · H.264 · AAC', 'u-3gp-h264-aac.3gp', 'Matrix.480p.WEB-DL.AAC.H264.3gp', '3gp', 'H.264', 'AAC'),
]

/** A picture no browser plays, converted as it plays. */
export const converted: Clip[] = [
  clip('avi · Xvid · MP3', 'c-avi-xvid-mp3.avi', 'Matrix.480p.DVDRip.MP3.XviD.avi', 'avi', 'Xvid', 'MP3'),
  clip('wmv · WMV 8 · WMA', 'c-wmv-wmv2-wma.wmv', 'Matrix.480p.WEB-DL.wmv', 'wmv', 'WMV 8', 'WMA'),
  clip('wmv · MS MPEG-4 · WMA', 'c-wmv-msmpeg4-wma.wmv', 'Matrix.480p.WEB-DL.wmv', 'wmv', 'MS MPEG-4', 'WMA'),
  clip('vob · MPEG-2 · Dolby Digital', 'c-vob-mpeg2-ac3.vob', 'Matrix.480p.DVDRip.DD5.1.vob', 'vob', 'MPEG-2', 'Dolby Digital'),
  clip('mpg · MPEG-1 · MP2', 'c-mpg-mpeg1-mp2.mpg', 'Matrix.480p.WEB-DL.mpg', 'mpg', 'MPEG-1', 'MP2'),
  clip('flv · Sorenson · MP3', 'c-flv-flv1-mp3.flv', 'Matrix.480p.WEB-DL.MP3.flv', 'flv', 'Sorenson H.263', 'MP3'),
  clip('avi · Motion JPEG · PCM', 'c-avi-mjpeg-pcm.avi', 'Matrix.480p.WEB-DL.avi', 'avi', 'Motion JPEG', 'PCM'),
  clip('ogv · Theora · Vorbis', 'c-ogv-theora-vorbis.ogv', 'Matrix.480p.WEB-DL.ogv', 'ogv', 'Theora', 'Vorbis'),
  clip('mkv · VP8 · Vorbis', 'c-mkv-vp8-vorbis.mkv', 'Matrix.480p.WEB-DL.mkv', 'mkv', 'VP8', 'Vorbis'),
  clip('mkv · H.264 10-bit · AAC', 'c-mkv-h264-hi10p-aac.mkv', 'Matrix.480p.BluRay.AAC.x264.10bit.mkv', 'mkv', 'H.264 10-bit', 'AAC'),
  clip('mkv · H.264 4:2:2 · AAC', 'c-mkv-h264-422-aac.mkv', 'Matrix.480p.WEB-DL.AAC.x264.mkv', 'mkv', 'H.264 4:2:2', 'AAC'),
  clip('mkv · HEVC · AAC', 'c-mkv-hevc-aac.mkv', 'Matrix.480p.WEB-DL.AAC.x265.mkv', 'mkv', 'HEVC', 'AAC'),
]
