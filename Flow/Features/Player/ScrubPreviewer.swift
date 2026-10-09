#if os(iOS)
import CoreGraphics
import CoreMedia
import CoreVideo
import VideoToolbox
import FlowKit

/// Pictures for the scrubber, decoded from single keyframes of a remuxed MKV. Each preview costs
/// one small range request and a hardware decode, and recent ones are kept.
actor ScrubPreviewer {
    private let remuxer: MatroskaRemuxer
    private let format: CMVideoFormatDescription
    private let size: CGSize
    private var session: VTDecompressionSession?
    private var cache: [Int: CGImage] = [:]
    private var order: [Int] = []

    /// H.264 and HEVC only; nil for Dolby Vision profile 5, whose colours need Dolby's own processing.
    init?(remuxer: MatroskaRemuxer, width: CGFloat = 360) {
        guard let v = remuxer.video, !remuxer.trickPlayFrames.isEmpty, v.source.width > 0, v.source.height > 0,
              !v.codecString.hasPrefix("dvh1") else { return nil }
        let codec: CMVideoCodecType
        let atom: String
        switch v.source.codecID {
        case "V_MPEG4/ISO/AVC": codec = kCMVideoCodecType_H264; atom = "avcC"
        case "V_MPEGH/ISO/HEVC": codec = kCMVideoCodecType_HEVC; atom = "hvcC"
        default: return nil
        }
        let extensions = [kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms: [atom: Data(v.source.codecPrivate)]] as CFDictionary
        var format: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: codec, width: Int32(v.source.width), height: Int32(v.source.height),
                                             extensions: extensions, formatDescriptionOut: &format) == noErr, let format else { return nil }
        var displayWidth = CGFloat(v.source.width)
        if let dw = v.source.displayWidth, let dh = v.source.displayHeight, dw > 0, dh > 0 {
            displayWidth = CGFloat(v.source.height) * CGFloat(dw) / CGFloat(dh)
        }
        let aspect = CGFloat(v.source.height) / displayWidth
        self.remuxer = remuxer
        self.format = format
        self.size = CGSize(width: (width / 2).rounded() * 2, height: (width * aspect / 2).rounded() * 2)
    }

    func image(at seconds: Double) async -> CGImage? {
        guard let index = remuxer.trickPlayIndex(at: seconds) else { return nil }
        if let hit = cache[index] { return hit }
        guard let frame = try? await remuxer.previewFrame(at: seconds), let image = decode(frame.data) else { return nil }
        cache[index] = image
        order.append(index)
        if order.count > 40 { cache[order.removeFirst()] = nil }
        return image
    }

    private func decode(_ data: [UInt8]) -> CGImage? {
        if session == nil {
            let attributes = [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
                              kCVPixelBufferWidthKey: Int(size.width), kCVPixelBufferHeightKey: Int(size.height)] as CFDictionary
            VTDecompressionSessionCreate(allocator: kCFAllocatorDefault, formatDescription: format, decoderSpecification: nil,
                                         imageBufferAttributes: attributes, outputCallback: nil, decompressionSessionOut: &session)
        }
        guard let session, !data.isEmpty else { return nil }

        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: data.count, blockAllocator: kCFAllocatorDefault,
                                                 customBlockSource: nil, offsetToData: 0, dataLength: data.count, flags: kCMBlockBufferAssureMemoryNowFlag,
                                                 blockBufferOut: &block) == noErr, let block else { return nil }
        let copied = data.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: data.count) }
        guard copied == noErr else { return nil }
        var sample: CMSampleBuffer?
        var sampleSize = data.count
        guard CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format, sampleCount: 1,
                                        sampleTimingEntryCount: 0, sampleTimingArray: nil, sampleSizeEntryCount: 1, sampleSizeArray: &sampleSize,
                                        sampleBufferOut: &sample) == noErr, let sample else { return nil }

        // Without the asynchronous flag the handler runs before DecodeFrame returns.
        let result = DecodedImage()
        let status = VTDecompressionSessionDecodeFrame(session, sampleBuffer: sample, flags: [], infoFlagsOut: nil) { status, _, buffer, _, _ in
            guard status == noErr, let buffer else { return }
            var image: CGImage?
            VTCreateCGImageFromCVPixelBuffer(buffer, options: nil, imageOut: &image)
            result.image = image
        }
        VTDecompressionSessionWaitForAsynchronousFrames(session)
        return status == noErr ? result.image : nil
    }

    private final class DecodedImage: @unchecked Sendable {
        var image: CGImage?
    }

    deinit {
        if let session { VTDecompressionSessionInvalidate(session) }
    }
}
#endif
