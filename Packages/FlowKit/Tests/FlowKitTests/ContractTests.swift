import XCTest
@testable import FlowKit

/// The rules the app and the website both implement, checked against the language-neutral vectors in
/// `testdata/contracts` at the repository root. The website reads the same files (web/src/contracts), so a rule
/// changed on one side and not the other fails a test on whichever side is behind.

struct ContractCase {
    let name: String
    let op: String?
    let input: JSONValue
    let expected: JSONValue
}

/// A case this platform can't run (AES-GCM on Linux). Counted and reported, and a failure on Apple platforms, where it exists.
struct ContractUnavailable: Error {
    let reason: String
}

enum Contracts {
    /// `testdata/contracts`, found from this file so Package.swift needs no resources: Tests/FlowKitTests/ is four levels under the root.
    static let directory: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("testdata/contracts", isDirectory: true)
    }()

    static func read(_ file: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: directory.appendingPathComponent(file)))
    }

    /// The areas the manifest says the apps read.
    static func manifestAreas() throws -> Set<String> {
        guard case .object(let areas)? = try read("manifest.json")["areas"] else { throw ContractUnavailable(reason: "manifest has no areas") }
        return Set(areas.filter { $0.value["swift"]?.bool == true }.keys)
    }

    static func cases(_ area: String) throws -> [ContractCase] {
        let file = try read("\(area).json")
        guard file["area"]?.string == area, let list = file["cases"]?.array else { throw ContractUnavailable(reason: "\(area).json is not an \(area) file") }
        return list.map { ContractCase(name: $0["name"]?.string ?? "", op: $0["op"]?.string, input: $0["input"] ?? .null, expected: $0["expected"] ?? .null) }
    }

    /// Every area the apps run, by the name of its vector file.
    static let runners: [String: (ContractCase) throws -> JSONValue] = [
        "account-number": accountNumber,
        "account-crypto": accountCrypto,
        "account-wire": accountWire,
    ]
}

final class ContractTests: XCTestCase {
    func testManifestAndVectorFilesAgreeWithTheRunners() throws {
        let listed = try Contracts.manifestAreas()
        XCTAssertEqual(listed, Set(Contracts.runners.keys), "the manifest and the Swift runners must list the same areas")
        let files = try FileManager.default.contentsOfDirectory(atPath: Contracts.directory.path).filter { $0.hasSuffix(".json") && $0 != "manifest.json" }
        let manifest = try Contracts.read("manifest.json")["areas"]?.object ?? [:]
        XCTAssertEqual(Set(files.map { String($0.dropLast(5)) }), Set(manifest.keys), "every vector file must be in the manifest, and every listed area must have its file")
    }

    func testEveryAreaAgreesWithItsVectors() throws {
        var ran = 0
        var unavailable: [String] = []
        for area in Contracts.runners.keys.sorted() {
            let cases = try Contracts.cases(area)
            XCTAssertFalse(cases.isEmpty, "\(area) has no cases")
            XCTAssertEqual(Set(cases.map(\.name)).count, cases.count, "\(area) has two cases with one name")
            for c in cases {
                do {
                    let actual = try Contracts.runners[area]!(c)
                    ran += 1
                    if AccountWire.canonical(actual) != AccountWire.canonical(c.expected) {
                        XCTFail("\(area): \(c.name)\n  expected \(AccountWire.canonical(c.expected))\n  got      \(AccountWire.canonical(actual))")
                    }
                } catch let error as ContractUnavailable {
                    unavailable.append("\(area): \(c.name): \(error.reason)")
                } catch {
                    XCTFail("\(area): \(c.name) threw \(error)")
                }
            }
        }
        XCTAssertGreaterThan(ran, 0)
        #if canImport(CryptoKit)
        XCTAssertEqual(unavailable, [], "on Apple platforms nothing is unavailable")
        #else
        // Linux has no AES-GCM here; the sealed-value cases are the only ones allowed to be missing.
        XCTAssertTrue(unavailable.allSatisfy { $0.hasPrefix("account-crypto: ") }, "\(unavailable)")
        #endif
    }
}

// MARK: - Helpers shared by the runners

extension JSONValue {
    static func int(_ value: Int) -> JSONValue { .number(Double(value)) }
    var isEmptyValue: Bool {
        switch self {
        case .null: return true
        case .array(let a): return a.isEmpty
        case .object(let o): return o.isEmpty
        default: return false
        }
    }
}

func hexString(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

func dataFromHex(_ text: String) -> Data {
    var out = Data()
    var index = text.startIndex
    while index < text.endIndex {
        let next = text.index(index, offsetBy: 2)
        out.append(UInt8(text[index..<next], radix: 16) ?? 0)
        index = next
    }
    return out
}

// MARK: - Account number

private func accountNumber(_ c: ContractCase) throws -> JSONValue {
    switch c.op {
    case "parse": return AccountNumber.parse(c.input.string ?? "").map { .string($0) } ?? .null
    case "formatTyped": return .string(AccountNumber.formatTyped(c.input.string ?? ""))
    case "group": return .string(AccountNumber.group(c.input.string ?? ""))
    case "generate":
        var blocks = c.input["blocks"]?.array ?? []
        return .string(AccountNumber.generate { count in
            guard !blocks.isEmpty else {
                XCTFail("drew more random bytes than the vector provides")
                return [UInt8](repeating: 0, count: count)
            }
            let block = blocks.removeFirst()
            if let bytes = block["bytes"]?.array { return bytes.map { UInt8($0.int ?? 0) } }
            return [UInt8](repeating: UInt8(block["fill"]?.int ?? 0), count: count)
        })
    default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
    }
}

// MARK: - Account crypto

private func accountCrypto(_ c: ContractCase) throws -> JSONValue {
    if c.op == "constants" {
        return .object(["iterations": .int(AccountKeys.iterations), "pbkdf2Salt": .string(String(decoding: AccountKeys.pbkdf2Salt, as: UTF8.self)), "hkdfSalt": .string(String(decoding: AccountKeys.hkdfSalt, as: UTF8.self))])
    }
    let number = c.input["number"]?.string ?? ""
    let rounds = c.input["iterations"]?.int ?? AccountKeys.iterations
    let keys = AccountKeys(number: number, iterations: rounds)
    switch c.op {
    case "derive":
        let master = PBKDF2SHA256.derive(password: Data(number.utf8), salt: AccountKeys.pbkdf2Salt, iterations: rounds, length: 32)
        return .object(["master": .string(hexString(master)), "id": .string(keys.id), "auth": .string(keys.auth), "enc": .string(hexString(keys.enc)), "authHash": .string(keys.authHash)])
    case "seal":
        #if canImport(CryptoKit)
        return .string(try keys.seal(c.input["plaintext"]?.string ?? "", section: c.input["section"]?.string ?? "", sealer: CryptoKitSealer(), nonce: dataFromHex(c.input["nonce"]?.string ?? "")))
        #else
        throw ContractUnavailable(reason: "no AES-GCM on this platform")
        #endif
    default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
    }
}

// MARK: - Account wire

/// A state from a vector, which leaves out the fields that are empty.
private func wireState(_ value: JSONValue) throws -> AccountWire.State {
    var object = value.object ?? [:]
    for (field, empty) in [("watchlist", JSONValue.array([])), ("favourites", .array([])), ("ratings", .object([:])), ("rewatches", .array([])), ("shuffle", .array([])),
                           ("progress", .array([])), ("sources", .object([:])), ("history", .array([])), ("removed", .object([:])), ("items", .object([:])), ("extra", .object([:]))]
    where object[field] == nil { object[field] = empty }
    return try JSONDecoder().decode(AccountWire.State.self, from: JSONEncoder().encode(JSONValue.object(object)))
}

/// A state as a vector writes it, without the fields that are empty.
private func sparse(_ state: AccountWire.State) throws -> JSONValue {
    let value = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(state))
    return .object((value.object ?? [:]).filter { !$0.value.isEmptyValue })
}

private func accountWire(_ c: ContractCase) throws -> JSONValue {
    let input = c.input
    switch c.op {
    case "canonical": return .string(AccountWire.canonical(input))
    case "time": return .string(AccountTime.string(ms: input.int ?? 0))
    case "parseTime": return .int(AccountTime.ms(input.string))
    case "id":
        switch input["kind"]?.string {
        case "progress": return .string(AccountWire.progressID(input["entry"]?.object ?? [:]))
        case "history": return .string(AccountWire.historyID(input["entry"]?.object ?? [:]))
        default: return .string(AccountWire.removedKey(input["list"]?.string ?? "", input["id"]?.string ?? ""))
        }
    case "section":
        if let key = input["isKey"]?.string { return .bool(AccountWire.isKey(key)) }
        if let name = input["isHistory"]?.string { return .bool(AccountWire.isHistorySection(name)) }
        if let name = input["isItems"]?.string { return .bool(AccountWire.isItemsSection(name)) }
        if let name = input["isLibrary"]?.string { return .bool(AccountWire.isLibrarySection(name)) }
        return .string(AccountWire.itemsShard(input["shard"]?.string ?? ""))
    case "read":
        let plain = (input.object ?? [:]).compactMapValues { $0.string }
        let read = AccountWire.read(plain)
        return .object(["state": try sparse(read.state), "unreadable": .array(read.unreadable.sorted().map { .string($0) }), "newer": .array(read.newer.sorted().map { .string($0) })])
    case "splitHistory":
        let removed = (input["removed"]?.object ?? [:]).compactMapValues { $0.string }
        let pages = AccountWire.splitHistory((input["entries"]?.array ?? []).compactMap { $0.object }, removed: removed, limit: input["limit"]?.int ?? AccountWire.pageLimit)
        return .object(pages.mapValues { .string($0) })
    case "write":
        let sections = AccountWire.write(try wireState(input["state"] ?? .null), now: AccountTime.ms(input["now"]))
        return .object(sections.mapValues { .string($0) })
    case "merge":
        let merged = AccountWire.merge(try wireState(input["local"] ?? .null), try wireState(input["remote"] ?? .null), now: AccountTime.ms(input["now"]))
        return try sparse(merged)
    default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
    }
}
