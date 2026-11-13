import XCTest
@testable import FlowKit

/// What goes to the built-in decoder: containers neither Apple's player nor the remuxer opens.
final class UniversalPlayerRoutingTests: XCTestCase {
    private func url(_ s: String) -> URL { URL(string: s)! }

    func testNamesOfContainersTheBuiltInDecoderPlays() {
        for (name, label) in [("a.avi", "AVI"), ("a.divx", "AVI"), ("a.wmv", "Windows Media"), ("a.asf", "Windows Media"), ("a.flv", "Flash Video"),
                              ("a.rmvb", "RealMedia"), ("a.vob", "DVD VOB"), ("a.mpg", "MPEG-PS"), ("a.mpeg", "MPEG-PS"), ("a.ogv", "Ogg"), ("a.ogm", "Ogg")] {
            XCTAssertEqual(ContainerDetector.container(url: url("https://x.test/\(name)"), filename: nil), .unsupported(label), name)
        }
        // The file name an add-on reports counts when the link has no extension.
        XCTAssertEqual(ContainerDetector.container(url: url("https://debrid.test/d/XYZ"), filename: "Movie.2004.DVDRip.XviD.avi"), .unsupported("AVI"))
    }

    func testApplesContainersStayOnApplesPath() {
        for name in ["a.mp4", "a.mov", "a.m4v", "a.m3u8", "a.ts", "a.m2ts", "a.mp3", "a.flac"] {
            XCTAssertEqual(ContainerDetector.container(url: url("https://x.test/\(name)"), filename: nil), .native, name)
        }
        XCTAssertEqual(ContainerDetector.container(url: url("https://x.test/a.mkv"), filename: nil), .matroska)
        XCTAssertEqual(ContainerDetector.container(url: url("https://x.test/a.webm"), filename: nil), .matroska)
    }

    func testSniffsContainersFromTheirFirstBytes() {
        XCTAssertEqual(ContainerDetector.sniff([0x00, 0x00, 0x01, 0xBA, 0x44, 0x00, 0x04, 0x00]), .unsupported("MPEG-PS"))
        XCTAssertEqual(ContainerDetector.sniff(Array("OggS".utf8) + [0, 2, 0, 0]), .unsupported("Ogg"))
        XCTAssertEqual(ContainerDetector.sniff(Array(".RMF".utf8) + [0, 0, 0, 0x12]), .unsupported("RealMedia"))
        XCTAssertEqual(ContainerDetector.sniff(Array("FLV".utf8) + [1, 5, 0, 0, 0, 9]), .unsupported("Flash Video"))
        XCTAssertEqual(ContainerDetector.sniff([0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11]), .unsupported("Windows Media"))
        XCTAssertEqual(ContainerDetector.sniff(Array("RIFF".utf8) + [0x10, 0, 0, 0] + Array("AVI LIST".utf8)), .unsupported("AVI"))
        // A WAVE file is also RIFF, and plays natively.
        XCTAssertEqual(ContainerDetector.sniff(Array("RIFF".utf8) + [0x10, 0, 0, 0] + Array("WAVEfmt ".utf8)), .native)
        // A transport stream and an MP4 are Apple's.
        XCTAssertEqual(ContainerDetector.sniff([0x47, 0x40, 0x00, 0x10]), .native)
        XCTAssertEqual(ContainerDetector.sniff([0, 0, 0, 0x20] + Array("ftypisom".utf8)), .native)
    }

    func testPlayerEngineDefaultsToAutomaticForOldSettings() throws {
        // Settings saved before the picker existed have no key for it.
        let old = try SettingsCodec.decode(PlaybackSettings.self, from: Data("{}".utf8), defaults: PlaybackSettings())
        XCTAssertEqual(old.playerEngine, .automatic)
        var changed = PlaybackSettings()
        changed.playerEngine = .builtIn
        let data = try SettingsCodec.encode(changed)
        let round = try SettingsCodec.decode(PlaybackSettings.self, from: data, defaults: PlaybackSettings())
        XCTAssertEqual(round.playerEngine, .builtIn)
    }
}

final class MPVOptionsTests: XCTestCase {
    func testHeaderFieldsKeepCommasInsideTheirValue() {
        XCTAssertEqual(MPVOptions.headerFields([:]), "")
        XCTAssertEqual(MPVOptions.headerFields(["Referer": "https://a.test/"]), "%24%Referer: https://a.test/")
        // Sorted by name; the length counts bytes, so an Accept list stays one field.
        let joined = MPVOptions.headerFields(["Accept": "a/b,c/d", "Cookie": "k=v"])
        XCTAssertEqual(joined, "%15%Accept: a/b,c/d,%11%Cookie: k=v")
    }

    func testBoostIsDecibelsOnTopOfTheFilesOwnLevel() {
        XCTAssertEqual(MPVOptions.volumePercent(boostDB: 0), 100)
        XCTAssertEqual(MPVOptions.volumePercent(boostDB: 6), 199.53, accuracy: 0.01)
        XCTAssertEqual(MPVOptions.volumePercent(boostDB: 6, level: 0.5), 99.76, accuracy: 0.01)
        XCTAssertEqual(MPVOptions.volumePercent(boostDB: -3), 100, "a negative boost is no boost")
    }

    func testChannelLabels() {
        XCTAssertEqual(MPVOptions.channelLabel(2), "Stereo")
        XCTAssertEqual(MPVOptions.channelLabel(6), "5.1")
        XCTAssertEqual(MPVOptions.channelLabel(8), "7.1")
        XCTAssertEqual(MPVOptions.channelLabel(12), "")
    }

    func testSubtitleLookBecomesMPVOptions() {
        var settings = SubtitleSettings()
        var options = Dictionary(uniqueKeysWithValues: MPVOptions.subtitleOptions(settings))
        XCTAssertEqual(options["sub-scale"], "1.00")
        XCTAssertEqual(options["sub-color"], "#FFFFFFFF")
        XCTAssertEqual(options["sub-pos"], "100")
        XCTAssertEqual(options["sub-border-size"], "0.0")
        XCTAssertEqual(options["sub-shadow-offset"], "1.5")
        XCTAssertEqual(options["sub-ass-override"], "strip")
        XCTAssertEqual(options["sub-border-style"], "outline-and-shadow")

        settings.fontScale = 1.5
        settings.color = .yellow
        settings.edgeStyle = .outline
        settings.background = .translucent
        settings.backgroundOpacity = 0.5
        settings.verticalPosition = 0.1
        settings.keepASSStyling = true
        settings.weight = .bold
        options = Dictionary(uniqueKeysWithValues: MPVOptions.subtitleOptions(settings))
        XCTAssertEqual(options["sub-scale"], "1.50")
        XCTAssertEqual(options["sub-color"], "#FFFFD60A")
        XCTAssertEqual(options["sub-border-size"], "2.5")
        XCTAssertEqual(options["sub-shadow-offset"], "0.0")
        XCTAssertEqual(options["sub-border-style"], "background-box")
        XCTAssertEqual(options["sub-back-color"], "#80000000")
        XCTAssertEqual(options["sub-pos"], "90")
        XCTAssertEqual(options["sub-ass-override"], "no")
        XCTAssertEqual(options["sub-bold"], "yes")
    }
}

