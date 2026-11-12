// swift-tools-version:5.10
import PackageDescription

// FFmpeg's DTS and TrueHD decoders for the MKV remuxer. Apps only: FlowKit itself stays pure Swift.
let package = Package(
    name: "FlowDecoders",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17)],
    products: [
        .library(name: "FlowDecoders", targets: ["FlowDecoders"]),
    ],
    dependencies: [
        .package(path: "../FlowKit"),
    ],
    targets: [
        // Built by scripts/build-ffmpeg-decoders.sh (LGPL 2.1; see FFmpegDecoders/README.md).
        .binaryTarget(name: "CFFmpegDecoders", path: "FFmpegDecoders/FFmpegDecoders.xcframework"),
        .target(name: "FlowDecoders", dependencies: ["CFFmpegDecoders", .product(name: "FlowKit", package: "FlowKit")],
                resources: [.copy("Resources/COPYING.LGPLv2.1")]),
    ]
)
