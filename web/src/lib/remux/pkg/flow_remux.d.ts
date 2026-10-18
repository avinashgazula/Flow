/* tslint:disable */
/* eslint-disable */

export class Remuxer {
    free(): void;
    [Symbol.dispose](): void;
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
    finish(): void;
    firstCluster(): number;
    fragmentEnd(): number;
    /**
     * True when the fragment starts on a keyframe (audio always does).
     */
    fragmentKey(): boolean;
    fragmentKind(): number;
    fragmentStart(): number;
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
     * The track's init segment, or undefined until the frame it's configured from has been read.
     * `codecString()` then holds its codec string.
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
     * `fragmentEnd()` (media seconds) and `fragmentKey()` describe it.
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
    select(video: number, audio: number): void;
    /**
     * Drops video fragments that end before `seconds`, while audio is rebuilt under a picture
     * that's already buffered.
     */
    setVideoFloor(seconds: number): void;
    /**
     * Text subtitle cues read since the last call, as JSON [{track, start, end, text}], or undefined.
     */
    takeCues(): string | undefined;
    timingKnown(): boolean;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_remuxer_free: (a: number, b: number) => void;
    readonly remuxer_codecString: (a: number, b: number) => void;
    readonly remuxer_cueCount: (a: number) => number;
    readonly remuxer_cuesBytes: (a: number, b: number) => void;
    readonly remuxer_cuesFeed: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly remuxer_cuesNeed: (a: number, b: number) => void;
    readonly remuxer_delay: (a: number) => number;
    readonly remuxer_finish: (a: number) => void;
    readonly remuxer_firstCluster: (a: number) => number;
    readonly remuxer_fragmentEnd: (a: number) => number;
    readonly remuxer_fragmentKey: (a: number) => number;
    readonly remuxer_fragmentKind: (a: number) => number;
    readonly remuxer_fragmentStart: (a: number) => number;
    readonly remuxer_headerError: (a: number, b: number) => void;
    readonly remuxer_headerFeed: (a: number, b: number, c: number, d: number) => void;
    readonly remuxer_headerJson: (a: number, b: number) => void;
    readonly remuxer_headerNeed: (a: number, b: number) => void;
    readonly remuxer_initSegment: (a: number, b: number, c: number) => void;
    readonly remuxer_loadCues: (a: number, b: number, c: number) => number;
    readonly remuxer_new: (a: number) => number;
    readonly remuxer_nextFragment: (a: number, b: number) => void;
    readonly remuxer_position: (a: number) => number;
    readonly remuxer_push: (a: number, b: number, c: number) => void;
    readonly remuxer_reset: (a: number, b: number, c: number) => void;
    readonly remuxer_seekTarget: (a: number, b: number, c: number) => void;
    readonly remuxer_select: (a: number, b: number, c: number) => void;
    readonly remuxer_setVideoFloor: (a: number, b: number) => void;
    readonly remuxer_takeCues: (a: number, b: number) => void;
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
