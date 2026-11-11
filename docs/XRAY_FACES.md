# X-Ray by faces on the Apple apps: a plan

Status: plan only, nothing implemented. The website has it (see `web/README.md`, "X-Ray: recognising faces"). Today the
apps' In Scene (`FlowKit/XRay/XRay.swift`, `Flow/Features/Player/XRayPanel.swift`) names characters mentioned in recent
subtitle dialogue. The goal is the same as the website's: recognise the faces in the current frame and match them to the
title's cast, on the device, with the dialogue guess as the fallback.

## How it works

1. **Cast prints.** For the title's TMDB cast (already loaded for X-Ray, first ~24 with a profile photo), fetch the `h632`
   photo, find the largest face, make a print (an embedding), and cache it per person, photo path and model version on disk
   (a small SQLite or a `Codable` file in Application Support, not iCloud). Each actor is computed once ever.
2. **Frame faces.** On X-Ray open, a pause or a seek, grab the current frame: `AVPlayerItemVideoOutput.copyPixelBuffer`
   (works for HLS and file playback; for the remuxed/AVSampleBufferDisplayLayer path, copy from the sample buffer the
   layer is given). Protected (FairPlay) content returns nothing, which is the "can't read the picture" fallback.
3. **Detect.** Vision's `VNDetectFaceLandmarksRequest` gives face boxes and eye, nose and mouth landmarks (no model to ship,
   uses the Neural Engine). Align each face to 112 x 112 with the same five-point similarity transform as the website
   (`geometry.ts`: `similarity`, `alignedCrop`), from Vision's landmark points.
4. **Embed.** A Core ML embedding model on the aligned crop (below), output L2-normalised.
5. **Match.** Cosine similarity against the cast prints; name a face only above a threshold and clear of the runner-up;
   each actor once; left to right. The website's `match.ts` is a direct port: thresholds must be re-measured per model.
6. **Fallback and honesty.** Same states and wording as `faces/scene.ts` ("Recognised in this frame", "Matched from
   dialogue.", "No one in this frame matched the cast."), and a Recognise Faces setting (default on) in Settings, Playback,
   X-Ray, with the footer saying faces never leave the device.

## Where it lives

- **FlowKit** (pure Swift, builds on Linux, unit-tested): `XRay/FaceMatching.swift` (cosine, normalise, `matchFaces` with the
  threshold and lead, ordering), `XRay/FaceGeometry.swift` (similarity transform, crop sampling over a plain `[UInt8]` RGBA
  frame), `XRay/SceneView.swift` (the wording as a pure function of face state, dialogue count and reads), and a
  `Settings.recogniseFaces = true` field with the default so old saved settings decode. Tests reuse the website's
  `prints.fixture.json` shape (real prints of public-domain photographs) plus the same threshold-gap test, so the two
  matchers can't drift, as `xray.test.ts` already does for dialogue.
- **App layer** (Apple-only, `#if canImport(Vision)`), kept thin: `Flow/Features/Player/FaceRecogniser.swift` wrapping Vision
  and Core ML behind a protocol FlowKit defines (`detect(frame) -> [Face]`, `print(frame, face) -> [Float]`) so FlowKit tests
  use a fake. `PlaybackSession` owns a `FaceScene` object next to its X-Ray and Shazam hooks: it keeps the cast prints,
  runs a look on open, on `seek`/pause, and every ~5 s while playing with the panel open (off with Low Power Mode, a hidden
  scene phase, or when the panel is closed), one look at a time, off the main actor. `XRayPanel` shows `sceneView(...)`.
- **tvOS:** same, Vision and Core ML are available; check focus on the new rows is unchanged (they reuse the existing row).

## Embedding model and the licensing question

This is the real risk, so it is decided before any code.

- **Candidates that ship permissive weights:** SFace (OpenCV Zoo, Apache-2.0 files; the website uses it, int8 10 MB, 128-d).
  Convert the ONNX to Core ML with `coremltools` (or `onnx-coreml` path via PyTorch), as an `.mlpackage` in FP16 (~19 MB)
  or 8-bit (~10 MB), compiled to `.mlmodelc` at build. Do the same conversion check as the website: similarities within
  0.01 of the ONNX on the fixtures.
- **Not usable:** InsightFace/ArcFace/Buffalo weights (non-commercial research licence), face-api.js and dlib's ResNet
  weights (terms unclear or restrictive), anything from Apple's private frameworks (the Photos people index is not
  exposed to apps).
- **Open question for the owner:** the SFace weights' Apache-2.0 licence comes from the OpenCV Zoo, while the upstream
  repository has no licence file and the paper trains on CASIA-WebFace, VGGFace2 and MS-Celeb-1M (research datasets, the last
  withdrawn by Microsoft). Using the weights is lawful under the licence given, but the training-data provenance is a
  reputational and possibly legal question for a public App Store app. Options: accept and disclose in Open Source
  Licences (as the website does); or train an embedding on a dataset with clear terms (costly); or ship the apps without
  faces. Also check App Store privacy: no data leaves the device, so "Data Not Collected" holds, but biometric
  identification in some regions (Illinois BIPA, EU GDPR art. 9) is regulated even on-device, so the setting default and
  wording deserve legal review before shipping.
- **Size:** about 10 to 19 MB in the app bundle, or an on-demand resource downloaded the first time Recognise Faces is used,
  which keeps the base download unchanged (preferred).

## Work, in order

1. Decide the licensing question above. 2. Convert and verify the model on the website's fixtures. 3. FlowKit matcher,
geometry and wording with tests. 4. `FaceRecogniser` plus `PlaybackSession` hook, check on iPhone, iPad, Mac and Apple TV
with the sample data (the sample streams are test cards with no faces, so verify with the fixture photographs played as a
still video through `scripts/player-check.sh`-style scenarios, as the website's `scripts/xray-faces-check.mjs` does).
5. Setting, footer, licences, TEST_PLAN notes. Expect about a week.

## Cost to measure first

Vision landmarks and a 112-pixel embedding are a few milliseconds each on the Neural Engine, so a background pass while
playing is likely affordable on the apps (unlike the website's single-thread WASM); measure battery before enabling one.
