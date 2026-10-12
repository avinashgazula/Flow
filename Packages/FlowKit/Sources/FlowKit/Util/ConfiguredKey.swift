import Foundation

/// Keys built into the app from Config/Secrets.xcconfig. A key left as the example file's
/// placeholder ("your-trakt-client-id") or never filled in ("$(FLOW_TRAKT_CLIENT_ID)") isn't a key:
/// treating it as one offers a sign-in that can only fail.
public enum ConfiguredKey {
    public static func usable(_ raw: String?) -> String? {
        guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        if value.hasPrefix("$(") { return nil }
        if value.lowercased().hasPrefix("your-") || value.lowercased().hasPrefix("your_") { return nil }
        return value
    }
}
