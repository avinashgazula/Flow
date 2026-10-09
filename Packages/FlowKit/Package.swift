// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "FlowKit",
    platforms: [.iOS(.v17), .macOS(.v14), .tvOS(.v17)],
    products: [
        .library(name: "FlowKit", targets: ["FlowKit"]),
    ],
    targets: [
        .target(name: "FlowKit"),
        .testTarget(name: "FlowKitTests", dependencies: ["FlowKit"]),
    ]
)
