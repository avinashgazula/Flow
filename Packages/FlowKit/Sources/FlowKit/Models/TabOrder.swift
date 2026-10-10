import Foundation

extension AppTab {
    /// `order` with repeats dropped and any tab it lacks appended, so a tab added in an update
    /// (or missing from an old export) always shows.
    public static func ordered(_ order: [AppTab]) -> [AppTab] {
        var seen = Set<AppTab>()
        let kept = order.filter { seen.insert($0).inserted }
        return kept + allCases.filter { !seen.contains($0) }
    }
}

extension GeneralSettings {
    /// The tabs as the tab bar and sidebar lay them out.
    public var orderedTabs: [AppTab] { AppTab.ordered(tabOrder) }
}
