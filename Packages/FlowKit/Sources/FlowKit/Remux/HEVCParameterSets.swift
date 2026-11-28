/// The parameter sets already carried by the HEVC sample description.
struct HEVCParameterSets: Sendable {
    private var units: [[UInt8]] = []
    private let lengthSize: Int

    init(configuration: [UInt8], lengthSize: Int) {
        self.lengthSize = lengthSize
        guard configuration.count >= 23 else { return }
        var offset = 23
        for _ in 0..<Int(configuration[22]) {
            guard offset + 3 <= configuration.count else { break }
            let type = configuration[offset] & 0x3f
            let count = Int(configuration[offset + 1]) << 8 | Int(configuration[offset + 2])
            offset += 3
            for _ in 0..<count {
                guard offset + 2 <= configuration.count else { return }
                let size = Int(configuration[offset]) << 8 | Int(configuration[offset + 1])
                offset += 2
                guard size <= configuration.count - offset else { return }
                if size > 0, (32...34).contains(type) {
                    units.append(Array(configuration[offset..<(offset + size)]))
                }
                offset += size
            }
        }
    }

    /// Remove exact duplicates of the VPS, SPS and PPS from hvc1/dvh1 samples. Retain unknown
    /// parameter sets, video data, and Dolby Vision RPUs. Unchanged samples reuse their original storage.
    func removingRepeatedUnits(from data: [UInt8]) -> [UInt8] {
        guard !units.isEmpty, (1...4).contains(lengthSize) else { return data }
        var result: [UInt8]?
        var offset = 0
        var keptFrom = 0
        while offset + lengthSize <= data.count {
            let start = offset + lengthSize
            let size = data[offset..<start].reduce(0) { ($0 << 8) | Int($1) }
            guard size >= 2, size <= data.count - start else { return data }
            let end = start + size
            if (32...34).contains((data[start] >> 1) & 0x3f),
               units.contains(where: { data[start..<end].elementsEqual($0) }) {
                if result == nil { result = [] }
                result?.append(contentsOf: data[keptFrom..<offset])
                keptFrom = end
            }
            offset = end
        }
        guard offset == data.count, var result else { return data }
        result.append(contentsOf: data[keptFrom...])
        return result
    }
}
