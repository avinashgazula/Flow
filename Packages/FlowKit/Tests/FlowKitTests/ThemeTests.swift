import XCTest
@testable import FlowKit

final class ThemeTests: XCTestCase {
    func testThemeDefaultsToAdmitOneAndRoundTrips() throws {
        // Settings saved before themes existed.
        let old = #"{"general":{"accent":"red"}}"#
        var settings = try SettingsCodec.decode(AppSettings.self, from: Data(old.utf8), defaults: AppSettings())
        XCTAssertEqual(settings.general.theme, .admitOne)
        XCTAssertEqual(ThemeChoice.default, .admitOne)
        XCTAssertEqual(ThemeChoice.allCases.map(\.rawValue), ["admitOne", "index", "openingNight"])
        XCTAssertEqual(ThemeChoice.allCases.map(\.title), ["Admit One", "Index", "Opening Night"])
        for choice in ThemeChoice.allCases {
            XCTAssertEqual(choice.id, choice.rawValue)
            settings.general.theme = choice
            let data = try SettingsCodec.encode(settings)
            let back = try SettingsCodec.decode(AppSettings.self, from: data, defaults: AppSettings())
            XCTAssertEqual(back.general.theme, choice)
        }
        // A theme from a newer build reads as the default and leaves the rest of the file, the old accent included, intact.
        let unknown = #"{"general":{"accent":"red","theme":"matinee"}}"#
        let decoded = try SettingsCodec.decode(AppSettings.self, from: Data(unknown.utf8), defaults: AppSettings())
        XCTAssertEqual(decoded.general.theme, .admitOne)
        XCTAssertEqual(decoded.general.accent, .red)
    }

    func testTheOldAccentStillDecodesAndEncodes() throws {
        var settings = AppSettings()
        settings.general.accent = .purple
        let data = try SettingsCodec.encode(settings)
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("\"accent\""))
        XCTAssertEqual(try SettingsCodec.decode(AppSettings.self, from: data, defaults: AppSettings()).general.accent, .purple)
    }

    func testHexAndContrastHelpers() {
        XCTAssertEqual(ThemePalette.hex(0xC9120A), "#c9120a")
        XCTAssertEqual(ThemePalette.hex(0x000001), "#000001")
        XCTAssertEqual(ThemePalette.contrast(0x000000, 0xFFFFFF), 21, accuracy: 0.01)
        XCTAssertEqual(ThemePalette.contrast(0x777777, 0x777777), 1, accuracy: 0.001)
        // The pair's order doesn't matter.
        XCTAssertEqual(ThemePalette.contrast(0xC9120A, 0xF4F1EA), ThemePalette.contrast(0xF4F1EA, 0xC9120A), accuracy: 0.0001)
    }

    func testEveryPairTheDesignUsesMeetsAAInEveryThemeOnBothSides() {
        for theme in ThemeChoice.allCases {
            for dark in [false, true] {
                let tokens = ThemePalette.tokens(theme, dark: dark)
                let byName = Dictionary(uniqueKeysWithValues: tokens.all.map { ($0.name, $0.value) })
                for pair in ThemePalette.requiredPairs {
                    let ratio = ThemePalette.contrast(byName[pair.foreground]!, byName[pair.background]!)
                    XCTAssertGreaterThanOrEqual(ratio, pair.minimum,
                        "\(theme.rawValue) \(dark ? "dark" : "light"): \(pair.foreground) on \(pair.background) is \(ratio), needs \(pair.minimum)")
                }
            }
        }
    }

    func testIndexIsTheOriginalPalette() {
        // The values the app shipped before themes existed (Theme.Tones), kept exactly.
        let light = ThemePalette.tokens(.index, dark: false)
        XCTAssertEqual([light.bg, light.fg, light.mark, light.spot, light.onSpot, light.muted, light.faint],
                       [0xFFFFFF, 0x0A0A0A, 0xC9120A, 0x1A3DFF, 0xFFFFFF, 0x555555, 0x636363])
        let dark = ThemePalette.tokens(.index, dark: true)
        XCTAssertEqual([dark.bg, dark.fg, dark.mark, dark.spot, dark.onSpot, dark.muted, dark.faint],
                       [0x0A0A0A, 0xF2F2EE, 0xFF5A4E, 0x8FA2FF, 0x0A0A0A, 0xB0B0AC, 0x8F8F8B])
    }
}

extension Contracts {
    /// The shared palettes (testdata/contracts/themes.json): the same file the website's tokens are checked against.
    static func themes(_ c: ContractCase) throws -> JSONValue {
        switch c.op {
        case "choices":
            return .array(ThemeChoice.allCases.map { .object(["id": .string($0.rawValue), "title": .string($0.title)]) })
        case "palette":
            guard let id = c.input["theme"]?.string, let theme = ThemeChoice(rawValue: id), let side = c.input["side"]?.string else {
                throw ContractUnavailable(reason: "unknown theme")
            }
            let tokens = ThemePalette.tokens(theme, dark: side == "dark")
            return .object(Dictionary(uniqueKeysWithValues: tokens.all.map { ($0.name, JSONValue.string(ThemePalette.hex($0.value))) }))
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }
}
