// swift-tools-version:5.10
import PackageDescription

// DTS and Dolby TrueHD decoding for the MKV remuxer, through the FFmpeg that MPVKit (the built-in player's
// libmpv) already links, so the app carries one copy of FFmpeg: two static copies clash on every avcodec_*
// symbol. Apps only: FlowKit itself stays pure Swift.
let package = Package(
    name: "FlowDecoders",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17)],
    products: [
        .library(name: "FlowDecoders", targets: ["FlowDecoders"]),
    ],
    dependencies: [
        .package(path: "../FlowKit"),
        .package(url: "https://github.com/mpvkit/MPVKit.git", exact: "1.1.0-n9.0.2"),
    ],
    targets: [
        // FFmpeg's headers, from MPVKit's n9.0.2 build (LGPL 2.1+; see COPYING.LGPLv2.1).
        .target(name: "CFFmpegDecoders", path: "Sources/CFFmpegDecoders"),
        .target(name: "FlowDecoders", dependencies: ["CFFmpegDecoders", .product(name: "FlowKit", package: "FlowKit"), .product(name: "MPVKit", package: "MPVKit")],
                resources: [.copy("Resources/COPYING.LGPLv2.1")]),
    ]
)
