import XCTest
@testable import FlowKit

/// Marquee Sync's key and pairing link (testdata/contracts/sync-key.json, sync-link.json).
extension Contracts {
    static func syncKey(_ c: ContractCase) throws -> JSONValue {
        switch c.op {
        case "encode":
            return .string(FlowSyncKey(bytes: dataFromHex(c.input.string ?? ""))?.text ?? "")
        case "parse":
            return (try? FlowSyncKey.parse(c.input.string ?? "")).map { .string(hexString($0.bytes)) } ?? .null
        case "derive":
            guard let key = FlowSyncKey(bytes: dataFromHex(c.input.string ?? "")) else { return .null }
            let derived = key.derived
            return .object(["id": .string(derived.id), "auth": .string(derived.auth), "enc": .string(hexString(derived.enc)), "authHash": .string(derived.authHash)])
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }

    static func syncLink(_ c: ContractCase) throws -> JSONValue {
        let input = c.input
        switch c.op {
        case "appLink", "webLink":
            let key = try XCTUnwrap(FlowSyncKey(bytes: dataFromHex(input["key"]?.string ?? "")))
            let pairing = try FlowSyncPairing(key: key, server: input["server"]?.string ?? "", token: input["token"]?.string ?? "")
            return .string(c.op == "appLink" ? FlowSyncLink.appLink(pairing) : FlowSyncLink.webLink(pairing, site: input["site"]?.string ?? ""))
        case "parse":
            guard let pairing = try? FlowSyncLink.parse(input.string ?? ""), let key = pairing.key else { return .null }
            return .object(["key": .string(hexString(key.bytes)), "server": .string(pairing.server), "token": .string(pairing.token)])
        case "parseWithDefault":
            guard let pairing = try? FlowSyncLink.parse(input["link"]?.string ?? "", defaultServer: input["defaultServer"]?.string), let key = pairing.key else { return .null }
            return .object(["key": .string(hexString(key.bytes)), "server": .string(pairing.server), "token": .string(pairing.token)])
        case "normalizeServer":
            return (try? FlowSyncPairing.normalizedServer(input.string ?? "")).map { .string($0) } ?? .null
        default: throw ContractUnavailable(reason: "unknown op \(c.op ?? "nil")")
        }
    }
}
