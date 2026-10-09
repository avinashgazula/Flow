import TVServices

/// Apple TV Top Shelf: Continue Watching (with progress) and the Watchlist, when Flow is in the top row.
final class ContentProvider: TVTopShelfContentProvider {
    override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
        guard let snapshot = FlowSnapshot.load() else { return completionHandler(nil) }
        var sections: [TVTopShelfItemCollection<TVTopShelfSectionedItem>] = []
        if !snapshot.continueWatching.isEmpty {
            let section = TVTopShelfItemCollection(items: snapshot.continueWatching.map { item(for: $0, shape: .hdtv) })
            section.title = "Continue Watching"
            sections.append(section)
        }
        if !snapshot.watchlist.isEmpty {
            let section = TVTopShelfItemCollection(items: snapshot.watchlist.map { item(for: $0, shape: .poster) })
            section.title = "Watchlist"
            sections.append(section)
        }
        completionHandler(sections.isEmpty ? nil : TVTopShelfSectionedContent(sections: sections))
    }

    private func item(for entry: FlowSnapshot.Item, shape: TVTopShelfSectionedItem.ImageShape) -> TVTopShelfSectionedItem {
        let item = TVTopShelfSectionedItem(identifier: entry.id)
        item.title = entry.title
        item.imageShape = shape
        if let url = shape == .poster ? (entry.posterURL ?? entry.imageURL) : (entry.imageURL ?? entry.posterURL) {
            item.setImageURL(url, for: .screenScale1x)
            item.setImageURL(url, for: .screenScale2x)
        }
        item.displayAction = TVTopShelfAction(url: entry.link)
        if let play = entry.playLink { item.playAction = TVTopShelfAction(url: play) }
        if let progress = entry.progress { item.playbackProgress = progress }
        return item
    }
}
