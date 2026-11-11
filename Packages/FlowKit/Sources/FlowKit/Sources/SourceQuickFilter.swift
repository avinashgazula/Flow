import Foundation

/// The chips above the source list, as the website's picker: show one resolution or one provider for this look at the
/// list. Not a setting; it starts at All each time the picker opens, and never changes what auto-play or the player's
/// fallbacks use. Pure, so the choices and the counts are tested.
public enum SourceQuickFilter: Hashable, Sendable {
    case all
    case resolution(VideoResolution)
    case provider(String)

    public struct ProviderChip: Hashable, Sendable, Identifiable {
        public var id: String
        public var name: String
    }

    /// The resolutions on offer, highest first. Sources that don't say theirs have no chip.
    public static func resolutions(in sources: [StreamSource]) -> [VideoResolution] {
        Set(sources.map(\.traits.resolution)).filter { $0 != .unknown }.sorted(by: >)
    }

    /// The providers that answered with something, in the order their sources are listed. Two providers can share
    /// a name, so the chip is the provider's ID.
    public static func providers(in sources: [StreamSource]) -> [ProviderChip] {
        var seen = Set<String>()
        return sources.compactMap { source in
            seen.insert(source.providerID).inserted ? ProviderChip(id: source.providerID, name: source.providerName) : nil
        }
    }

    /// Chips only help when there is something to choose between.
    public static func hasChoices(in sources: [StreamSource]) -> Bool {
        resolutions(in: sources).count > 1 || providers(in: sources).count > 1
    }

    public func apply(to sources: [StreamSource]) -> [StreamSource] {
        switch self {
        case .all: return sources
        case .resolution(let resolution): return sources.filter { $0.traits.resolution == resolution }
        case .provider(let id): return sources.filter { $0.providerID == id }
        }
    }

    /// How many of what the providers found the picker's settings left out (resolution cap, filters, result cap).
    public static func hiddenCount(found: [StreamSource], shown: [StreamSource]) -> Int {
        max(0, found.count - shown.count)
    }
}
