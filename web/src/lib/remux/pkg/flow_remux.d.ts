/* tslint:disable */
/* eslint-disable */

export class OpusMuxer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The codec string for `addSourceBuffer`.
     */
    codec(): string;
    /**
     * One moof+mdat. `base_time` is the first packet's time in 48 kHz ticks, `data` holds the packets
     * back to back, and `sizes` and `durations` (ticks, usually 960) give each one's length and length
     * in time. A packet that `data` doesn't fully hold, and any after it, is left out.
     */
    fragment(base_time: number, data: Uint8Array, sizes: Uint32Array, durations: Uint32Array): Uint8Array;
    /**
     * ftyp + moov for one audio track (id 1) at 48 kHz, with no samples: they arrive as fragments.
     */
    init(): Uint8Array;
    /**
     * `pre_skip` is the encoder's lookahead in 48 kHz samples, which players trim from the start.
     * Channels run from 1 to 8.
     */
    constructor(channels: number, pre_skip: number);
}

export class Remuxer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns the next range the chapter list needs, if any.
     */
    chaptersFeed(offset: number, bytes: Uint8Array): Float64Array;
    /**
     * The chapters as JSON [{title, start}], start in seconds of file time (add `delay()` for media time).
     */
    chaptersJson(): string;
    /**
     * [offset, length] of the next read the chapter list needs, or empty when it is read (or the file has none). Chapters that
     * sit before the first cluster are read with the header; the rest are found through the SeekHead, like the index.
     */
    chaptersNeed(): Float64Array;
    codecString(): string;
    cueCount(): number;
    /**
     * The raw Cues element, for caching.
     */
    cuesBytes(): Uint8Array;
    /**
     * Returns the next range the index needs, if any.
     */
    cuesFeed(offset: number, bytes: Uint8Array): Float64Array;
    cuesNeed(): Float64Array;
    /**
     * Seconds added to every timestamp so B-frames never need a negative decode time.
     */
    delay(): number;
    /**
     * Everything the header and the far reads found, as one blob for the worker's cache; empty until they are done.
     */
    exportHeader(): Uint8Array;
    finish(): void;
    firstCluster(): number;
    fragmentEnd(): number;
    /**
     * True when the fragment starts on a keyframe (audio always does).
     */
    fragmentKey(): boolean;
    fragmentKind(): number;
    /**
     * Kind 2 only: the length in bytes of each payload in the fragment.
     */
    fragmentSizes(): Uint32Array;
    fragmentStart(): number;
    /**
     * Kind 2 only: each payload's media time in seconds, on the same timeline as every fragment.
     */
    fragmentTimes(): Float64Array;
    /**
     * Why the file can't be played, in words for the viewer.
     */
    headerError(): string | undefined;
    headerFeed(offset: number, bytes: Uint8Array): void;
    headerJson(): string;
    /**
     * [offset, length] of the next header read, or an empty array when the header is done (or failed).
     */
    headerNeed(): Float64Array;
    /**
     * Starts from a blob `exportHeader` made for this file: the header, the index and the chapters, with nothing to read.
     * False (and nothing changed) when it isn't one.
     */
    importHeader(raw: Uint8Array): boolean;
    /**
     * The track's init segment, or undefined until the frame it's configured from has been read.
     * `codecString()` then holds its codec string. Always undefined for a raw track.
     */
    initSegment(track: number): Uint8Array | undefined;
    /**
     * Loads a Cues element saved from an earlier visit.
     */
    loadCues(raw: Uint8Array): boolean;
    /**
     * `length` is the file's size in bytes, or 0 when the server didn't say.
     */
    constructor(length: number);
    /**
     * The next moof+mdat, or undefined. `fragmentKind()` (0 video, 1 audio), `fragmentStart()` and
     * `fragmentEnd()` (media seconds) and `fragmentKey()` describe it. Kind 2 is raw audio (see
     * `select`): the bytes are the payloads back to back, `fragmentSizes()` and `fragmentTimes()` split
     * them, and start and end are the first and last payload's time.
     */
    nextFragment(): Uint8Array | undefined;
    /**
     * Absolute offset just past the bytes pushed so far.
     */
    position(): number;
    push(bytes: Uint8Array): void;
    reset(offset: number, aligned: boolean): void;
    /**
     * [byte offset, media time of the keyframe there, 1 if the offset is a cluster's start].
     */
    seekTarget(seconds: number): Float64Array;
    /**
     * Chooses the picture subtitle track to decode (0 for none). Packets already read are decoded at once.
     */
    selectPicture(track: number): void;
    /**
     * Picks the tracks to remux (0 for none). With `raw`, an audio track whose header `decode` isn't
     * empty is selectable even though browsers can't play it, and its frames come out of
     * `nextFragment()` as kind 2 instead of being muxed.
     */
    select(video: number, audio: number, raw: boolean): void;
    /**
     * Drops video fragments that end before `seconds`, while audio is rebuilt under a picture
     * that's already buffered.
     */
    setVideoFloor(seconds: number): void;
    /**
     * Text subtitle cues read since the last call, as JSON [{track, start, end, text}], or undefined.
     */
    takeCues(): string | undefined;
    /**
     * Picture subtitle cues decoded since the last call, in the layout lib/remux/pictures.ts reads, or undefined.
     */
    takePictureCues(): Uint8Array | undefined;
    /**
     * The codec string for a WebCodecs `VideoDecoder` for the selected picture track, or empty when
     * there is none to give (no picture, a codec the remuxer can't carry). `frame` is a keyframe's
     * payload (VP9's string needs one to be exact) or empty. `thumbDescription()` is the decoder's
     * `description` (avcC, hvcC or av1C; empty for VP9).
     */
    thumbCodec(frame: Uint8Array): string;
    thumbDescription(): Uint8Array;
    /**
     * Looks for the keyframe in `bytes`, which start at the target's offset (`aligned`, `relative` and
     * `token` as `thumbTarget` gave them; pass -1 for the last two to take the cluster's first
     * keyframe). Returns [0, media time, payload length] when found (`thumbPayload()` has the bytes),
     * [1, bytes needed from the start of `bytes`] when it needs more (a lower bound), or [2] when that
     * cluster has no keyframe of the picture. Stateless: it never disturbs what is streaming.
     */
    thumbFind(bytes: Uint8Array, aligned: boolean, relative: number, token: number): Float64Array;
    /**
     * The payload `thumbFind` found, handed over once.
     */
    thumbPayload(): Uint8Array;
    /**
     * Where to read a seek preview from, for the time `seconds`: [byte offset, media time of the keyframe
     * there, 1 if the offset is a cluster's start, the keyframe's position inside the cluster or -1, the
     * index entry's token or -1]. The last three go back to `thumbFind` as they are. Needs a picture
     * track selected; the read can happen while the file streams.
     */
    thumbTarget(seconds: number): Float64Array;
    timingKnown(): boolean;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_opusmuxer_free: (a: number, b: number) => void;
    readonly __wbg_remuxer_free: (a: number, b: number) => void;
    readonly opusmuxer_codec: (a: number, b: number) => void;
    readonly opusmuxer_fragment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly opusmuxer_init: (a: number, b: number) => void;
    readonly opusmuxer_new: (a: number, b: number) => number;
    readonly remuxer_chaptersFeed: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly remuxer_chaptersJson: (a: number, b: number) => void;
    readonly remuxer_chaptersNeed: (a: number, b: number) => void;
    readonly remuxer_codecString: (a: number, b: number) => void;
    readonly remuxer_cueCount: (a: number) => number;
    readonly remuxer_cuesBytes: (a: number, b: number) => void;
    readonly remuxer_cuesFeed: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly remuxer_cuesNeed: (a: number, b: number) => void;
    readonly remuxer_delay: (a: number) => number;
    readonly remuxer_exportHeader: (a: number, b: number) => void;
    readonly remuxer_finish: (a: number) => void;
    readonly remuxer_firstCluster: (a: number) => number;
    readonly remuxer_fragmentEnd: (a: number) => number;
    readonly remuxer_fragmentKey: (a: number) => number;
    readonly remuxer_fragmentKind: (a: number) => number;
    readonly remuxer_fragmentSizes: (a: number, b: number) => void;
    readonly remuxer_fragmentStart: (a: number) => number;
    readonly remuxer_fragmentTimes: (a: number, b: number) => void;
    readonly remuxer_headerError: (a: number, b: number) => void;
    readonly remuxer_headerFeed: (a: number, b: number, c: number, d: number) => void;
    readonly remuxer_headerJson: (a: number, b: number) => void;
    readonly remuxer_headerNeed: (a: number, b: number) => void;
    readonly remuxer_importHeader: (a: number, b: number, c: number) => number;
    readonly remuxer_initSegment: (a: number, b: number, c: number) => void;
    readonly remuxer_loadCues: (a: number, b: number, c: number) => number;
    readonly remuxer_new: (a: number) => number;
    readonly remuxer_nextFragment: (a: number, b: number) => void;
    readonly remuxer_position: (a: number) => number;
    readonly remuxer_push: (a: number, b: number, c: number) => void;
    readonly remuxer_reset: (a: number, b: number, c: number) => void;
    readonly remuxer_seekTarget: (a: number, b: number, c: number) => void;
    readonly remuxer_select: (a: number, b: number, c: number, d: number) => void;
    readonly remuxer_selectPicture: (a: number, b: number) => void;
    readonly remuxer_setVideoFloor: (a: number, b: number) => void;
    readonly remuxer_takeCues: (a: number, b: number) => void;
    readonly remuxer_takePictureCues: (a: number, b: number) => void;
    readonly remuxer_thumbCodec: (a: number, b: number, c: number, d: number) => void;
    readonly remuxer_thumbDescription: (a: number, b: number) => void;
    readonly remuxer_thumbFind: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly remuxer_thumbPayload: (a: number, b: number) => void;
    readonly remuxer_thumbTarget: (a: number, b: number, c: number) => void;
    readonly remuxer_timingKnown: (a: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
