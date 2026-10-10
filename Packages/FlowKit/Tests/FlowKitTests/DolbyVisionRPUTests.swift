import XCTest
@testable import FlowKit

final class DolbyVisionRPUTests: XCTestCase {
    /// One RPU from a UHD Blu-ray (profile 7.6, MEL), as stored in the file: NAL header and escaped payload.
    static let profile7RPU = hex("7c011908090840613650af003ff801ffc00ffc001fffa000001000000d0000030080000068000004000003000040000020000020000003000400000302000003020000030000400000200000200000392b300001af512b37cfe758e12b3226500000080000030040000003004000000300e1b112180c3052f1847028a000000d31f2d7fff800000300000300000300030103ee700a840030080657b40300c028216547823b080056a4000180564726af8694b000ec88000300b01e485ff157a001e810000808f9825c20140000030008a0454048307d00019018980778f7aaadeb80")

    func testParsesAndWritesBackExactly() throws {
        let rpu = try XCTUnwrap(DolbyVisionRPU.parse(nal: Self.profile7RPU))
        XCTAssertEqual(rpu.vdrRPUProfile, 1)
        XCTAssertFalse(rpu.disableResidual)
        guard case .explicit(let mapping) = rpu.mapping else { return XCTFail("expected an explicit mapping") }
        XCTAssertEqual(mapping.nlq.count, 3)
        XCTAssertNotNil(rpu.dm)
        var payload = DolbyVisionRPU.unescape(Array(Self.profile7RPU[2...]))
        while payload.last == 0 { payload.removeLast() }
        XCTAssertEqual(rpu.write(), payload)
    }

    /// Profile 8.1: no residual, no enhancement-layer data, no-op curves, the same display metadata,
    /// and a CRC a decoder accepts (`parse` checks it).
    func testConvertsToProfile81() throws {
        let original = try XCTUnwrap(DolbyVisionRPU.parse(nal: Self.profile7RPU))
        let converted = try XCTUnwrap(DolbyVisionRPU.convertToProfile81(nal: Self.profile7RPU))
        XCTAssertEqual(Array(converted[0..<2]), [0x7C, 0x01])
        let rpu = try XCTUnwrap(DolbyVisionRPU.parse(nal: converted))
        XCTAssertTrue(rpu.disableResidual)
        XCTAssertFalse(rpu.blVideoFullRange)
        XCTAssertFalse(rpu.elSpatialResamplingFilter)
        guard case .explicit(let mapping) = rpu.mapping else { return XCTFail("expected an explicit mapping") }
        XCTAssertTrue(mapping.nlq.isEmpty)
        XCTAssertNil(mapping.nlqMethod)
        XCTAssertEqual(mapping.pivotDeltas, Array(repeating: [0, 1023], count: 3))
        let identity = DolbyVisionRPU.Piece.polynomial(orderMinus1: 0, coefficients: [.init(integer: 0, fraction: 0), .init(integer: 1, fraction: 0)])
        XCTAssertEqual(mapping.pieces, Array(repeating: [identity], count: 3))
        XCTAssertEqual(rpu.dm, original.dm)
        // Converting twice changes nothing more.
        XCTAssertEqual(DolbyVisionRPU.convertToProfile81(nal: converted), converted)
    }

    /// Samples lose their enhancement layer (type 63) and keep everything else, RPU converted.
    func testSampleRewrite() throws {
        let slice: [UInt8] = [0x02, 0x01, 0xAA, 0xBB]
        let enhancement: [UInt8] = [0x7E, 0x01, 0x11, 0x22, 0x33]
        func lengthPrefixed(_ nal: [UInt8]) -> [UInt8] { withUnsafeBytes(of: UInt32(nal.count).bigEndian, Array.init) + nal }
        let sample = lengthPrefixed(slice) + lengthPrefixed(enhancement) + lengthPrefixed(Self.profile7RPU)
        let rewritten = DolbyVisionRPU.profile81Sample(sample, lengthSize: 4)
        let converted = try XCTUnwrap(DolbyVisionRPU.convertToProfile81(nal: Self.profile7RPU))
        XCTAssertEqual(rewritten, lengthPrefixed(slice) + lengthPrefixed(converted))
    }

    func testCorruptRPUIsRejected() {
        var corrupt = Self.profile7RPU
        corrupt[40] ^= 0x04
        XCTAssertNil(DolbyVisionRPU.parse(nal: corrupt))
    }

    static func hex(_ s: String) -> [UInt8] {
        var out: [UInt8] = []
        var index = s.startIndex
        while index < s.endIndex {
            let next = s.index(index, offsetBy: 2)
            out.append(UInt8(s[index..<next], radix: 16)!)
            index = next
        }
        return out
    }
}
