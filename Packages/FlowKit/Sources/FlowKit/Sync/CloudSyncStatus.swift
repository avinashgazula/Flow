import Foundation

/// What Data & Storage shows under the iCloud toggle: per-domain agreement and how full the store is.
public struct CloudSyncStatus: Equatable, Sendable {
    public enum Health: Sendable { case synced, warning, failed }

    public struct Row: Equatable, Sendable, Identifiable {
        public var domain: CloudDomain
        public var localCount: Int
        public var cloudCount: Int?
        public var health: Health
        public var id: String { domain.id }
    }

    public var rows: [Row]
    public var usedBytes: Int
    public var quotaBytes: Int

    /// Above this share of the quota the storage row warns.
    public static let warnFraction = 0.8

    public init(domains: [CloudDomainStatus], usedBytes: Int, quotaBytes: Int = CloudSync.quotaBytes, writeFailed: Bool = false) {
        self.usedBytes = usedBytes
        self.quotaBytes = quotaBytes
        rows = domains.map { status in
            // Only the newest resume positions are uploaded, so a longer local list still agrees.
            let local = status.domain == .playbackProgress ? min(status.localCount, CloudSync.progressLimit) : status.localCount
            let agrees = (status.cloudCount ?? 0) == local
            let health: Health = agrees ? .synced : (writeFailed ? .failed : .warning)
            return Row(domain: status.domain, localCount: status.localCount, cloudCount: status.cloudCount, health: health)
        }
    }

    public var usedFraction: Double { quotaBytes > 0 ? Double(usedBytes) / Double(quotaBytes) : 0 }

    public var storageHealth: Health {
        if usedBytes > quotaBytes { return .failed }
        return usedFraction > Self.warnFraction ? .warning : .synced
    }

    /// The worst of the rows and storage, for a single summary.
    public var health: Health {
        let all = rows.map(\.health) + [storageHealth]
        return all.contains(.failed) ? .failed : (all.contains(.warning) ? .warning : .synced)
    }
}
