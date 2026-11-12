import Foundation

/// Values written by the website's `writeState` (web/src/lib/account/wire.ts) for one library, 2026-11-01T12:00:00Z as "now",
/// and the same library after the website's `mergeState` with nothing (which also puts resume points newest first). The apps
/// must read them and write them back to exactly the same text: the cross-check between the two implementations.
enum AccountFixtures {
    static let webValues: [String: String] = [
        "history-1970-01": #"""
{"entries":[],"month":"1970-01","removed":{"history:movie:9:-:1":"2026-11-01T11:59:59.500Z"},"v":1}
"""#,
        "history-2026-09": #"""
{"entries":[{"episode":{"episode":1,"season":1},"key":"show:2","runtime":47,"watchedAt":"2026-09-22T12:00:00.000Z"}],"month":"2026-09","removed":{},"v":1}
"""#,
        "history-2026-11": #"""
{"entries":[{"key":"movie:1","watchedAt":"2026-11-01T11:59:59.300Z"}],"month":"2026-11","removed":{},"v":1}
"""#,
        "items-1": #"""
{"items":{"movie:1":{"date":"2024-03-01","genres":[878,12],"poster":"/a.jpg","rating":8.1,"title":"One","year":2024},"movie:17":{"title":"Seventeen"}},"v":1}
"""#,
        "items-2": #"""
{"items":{"show:2":{"title":"Two"}},"v":1}
"""#,
        "lists": #"""
{"favourites":[{"addedAt":"2026-11-01T11:59:56.000Z","key":"show:2"}],"futureField":{"a":[1,2]},"order":{"keys":["movie:1","movie:17"],"updatedAt":"2026-11-01T11:59:59.600Z"},"ratings":{"movie:1":{"ratedAt":"2026-11-01T11:59:57.000Z","value":9}},"removed":{"watchlist:movie:3":"2026-11-01T11:59:59.400Z"},"rewatches":[{"key":"show:2","startedAt":"2026-11-01T11:59:58.000Z","updatedAt":"2026-11-01T11:59:59.000Z","watched":[{"episode":1,"season":1},{"episode":2,"season":1}]}],"shuffle":[{"key":"show:2","played":[{"episode":4,"season":2}]}],"v":1,"watchlist":[{"addedAt":"2026-11-01T11:59:55.000Z","key":"movie:1"},{"addedAt":"2026-11-01T11:59:54.000Z","key":"movie:17","note":"ünï \"q\" / \\ \n"}]}
"""#,
        "progress": #"""
{"entries":[{"durationSeconds":6000.25,"key":"movie:1","percent":12.5,"positionSeconds":750,"updatedAt":"2026-11-01T11:59:59.100Z"},{"durationSeconds":2840,"episode":{"episode":3,"season":1},"key":"show:2","percent":41.5,"positionSeconds":1180,"updatedAt":"2026-11-01T11:59:59.200Z"}],"removed":{},"v":1}
"""#,
        "sources": #"""
{"entries":{"movie:1":{"date":"2026-11-01T11:59:59.300Z","filename":"Dune.Part.Two.2024.2160p.mkv","hdr":["DV"],"providerID":"https://addon.example/manifest.json","quality":"WEB-DL","resolution":2160}},"removed":{},"v":1}
"""#,
    ]

    static let webMergedValues: [String: String] = [
        "history-1970-01": #"""
{"entries":[],"month":"1970-01","removed":{"history:movie:9:-:1":"2026-11-01T11:59:59.500Z"},"v":1}
"""#,
        "history-2026-09": #"""
{"entries":[{"episode":{"episode":1,"season":1},"key":"show:2","runtime":47,"watchedAt":"2026-09-22T12:00:00.000Z"}],"month":"2026-09","removed":{},"v":1}
"""#,
        "history-2026-11": #"""
{"entries":[{"key":"movie:1","watchedAt":"2026-11-01T11:59:59.300Z"}],"month":"2026-11","removed":{},"v":1}
"""#,
        "items-1": #"""
{"items":{"movie:1":{"date":"2024-03-01","genres":[878,12],"poster":"/a.jpg","rating":8.1,"title":"One","year":2024},"movie:17":{"title":"Seventeen"}},"v":1}
"""#,
        "items-2": #"""
{"items":{"show:2":{"title":"Two"}},"v":1}
"""#,
        "lists": #"""
{"favourites":[{"addedAt":"2026-11-01T11:59:56.000Z","key":"show:2"}],"futureField":{"a":[1,2]},"order":{"keys":["movie:1","movie:17"],"updatedAt":"2026-11-01T11:59:59.600Z"},"ratings":{"movie:1":{"ratedAt":"2026-11-01T11:59:57.000Z","value":9}},"removed":{"watchlist:movie:3":"2026-11-01T11:59:59.400Z"},"rewatches":[{"key":"show:2","startedAt":"2026-11-01T11:59:58.000Z","updatedAt":"2026-11-01T11:59:59.000Z","watched":[{"episode":1,"season":1},{"episode":2,"season":1}]}],"shuffle":[{"key":"show:2","played":[{"episode":4,"season":2}]}],"v":1,"watchlist":[{"addedAt":"2026-11-01T11:59:55.000Z","key":"movie:1"},{"addedAt":"2026-11-01T11:59:54.000Z","key":"movie:17","note":"ünï \"q\" / \\ \n"}]}
"""#,
        "progress": #"""
{"entries":[{"durationSeconds":2840,"episode":{"episode":3,"season":1},"key":"show:2","percent":41.5,"positionSeconds":1180,"updatedAt":"2026-11-01T11:59:59.200Z"},{"durationSeconds":6000.25,"key":"movie:1","percent":12.5,"positionSeconds":750,"updatedAt":"2026-11-01T11:59:59.100Z"}],"removed":{},"v":1}
"""#,
        "sources": #"""
{"entries":{"movie:1":{"date":"2026-11-01T11:59:59.300Z","filename":"Dune.Part.Two.2024.2160p.mkv","hdr":["DV"],"providerID":"https://addon.example/manifest.json","quality":"WEB-DL","resolution":2160}},"removed":{},"v":1}
"""#,
    ]
}
