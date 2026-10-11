import Foundation
import AVFoundation
import CoreMedia
import FlowKit

/// Lines a loaded subtitle file up with a remuxed film's dialogue: reads a few minutes of the playing
/// soundtrack straight from the remuxer, finds where there is speech, and asks FlowKit which delay makes
/// the cues cover it best.
enum SubtitleAutoSync {
    enum Outcome {
        case matched(offset: Double, confidence: Double)
        case noMatch
        /// The soundtrack couldn't be decoded here.
        case unreadable
    }

    /// Speech detection needs little more than 3.5 kHz of bandwidth.
    private static let sampleRate = 16_000
    /// How much of the film to listen to, centred on the playhead.
    private static let window = 180.0

    /// `offset` is the absolute delay to apply to the document's own cue times, not a change to the current one.
    static func analyse(remuxer: MatroskaRemuxer, track: MatroskaRemuxer.OutputTrack, around position: Double,
                        subtitle: SubtitleDocument) async -> Outcome {
        let duration = remuxer.duration > 0 ? remuxer.duration : position + window
        let end = min(duration, max(0, position - window / 2) + window)
        let start = max(0, end - window)
        let indices = remuxer.segments.filter { $0.duration > 0 && Double($0.end) / 1e9 > start && Double($0.start) / 1e9 < end }.map(\.index)
        guard let first = indices.first, let initBytes = await remuxer.initSegment(track: track.id) else { return .unreadable }

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("subtitle-sync-\(UUID().uuidString)", isDirectory: true)
        guard (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil else { return .unreadable }
        defer { try? FileManager.default.removeItem(at: folder) }

        // One segment at a time, so only its decoded audio is ever in memory; the rest is frame energies.
        var analyzer = SubtitleSync.SpeechAnalyzer(sampleRate: sampleRate)
        var decoded = 0
        for index in indices {
            if Task.isCancelled { return .noMatch }
            let segment = remuxer.segments[index]
            let wanted = Int((segment.duration * Double(sampleRate)).rounded())
            var samples: [Float] = []
            if let fragment = try? await remuxer.mediaSegment(track: track.id, index: index) {
                let file = folder.appendingPathComponent("\(index).mp4")
                if (try? Data(initBytes + fragment).write(to: file)) != nil {
                    samples = (try? await monoSamples(file)) ?? []
                    try? FileManager.default.removeItem(at: file)
                }
            }
            if !samples.isEmpty { decoded += 1 }
            // A segment that fails reads as silence, and each keeps its own length so later ones stay in time.
            if samples.count > wanted { samples.removeLast(samples.count - wanted) }
            else if samples.count < wanted { samples += Array(repeating: 0, count: wanted - samples.count) }
            analyzer.append(samples)
        }
        guard decoded * 2 >= indices.count else { return .unreadable }

        let speech = analyzer.finish()
        let windowStart = remuxer.segments[first].start
        let found = SubtitleSync.bestOffset(speech: speech, start: Double(windowStart) / 1e9, cues: subtitle)
        return found.map { .matched(offset: $0.offset, confidence: $0.confidence) } ?? .noMatch
    }

    /// One fragmented-MP4 file decoded to mono 32-bit float at `sampleRate`; the system decoders handle
    /// AAC, AC-3, E-AC-3 and FLAC, and mix surround down.
    private static func monoSamples(_ file: URL) async throws -> [Float] {
        try await Task.detached(priority: .utility) {
            let asset = AVURLAsset(url: file)
            guard let track = try await asset.loadTracks(withMediaType: .audio).first else { return [] }
            let reader = try AVAssetReader(asset: asset)
            let output = AVAssetReaderAudioMixOutput(audioTracks: [track], audioSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVLinearPCMIsFloatKey: true,
                AVLinearPCMBitDepthKey: 32,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: 1,
            ])
            guard reader.canAdd(output) else { return [] }
            reader.add(output)
            guard reader.startReading() else { return [] }
            var samples: [Float] = []
            while let buffer = output.copyNextSampleBuffer() {
                guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
                var chunk = [Float](repeating: 0, count: CMBlockBufferGetDataLength(block) / MemoryLayout<Float>.size)
                guard !chunk.isEmpty else { continue }
                let bytes = chunk.count * MemoryLayout<Float>.size
                let status = chunk.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes, destination: $0.baseAddress!) }
                if status == kCMBlockBufferNoErr { samples += chunk }
            }
            return samples
        }.value
    }
}
