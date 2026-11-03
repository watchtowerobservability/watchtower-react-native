import Foundation
import React
#if canImport(WatchtowerSDK)
import WatchtowerSDK // the CocoaPods pod
#else
import Watchtower // Swift Package Manager
#endif

/// Bridge between the JS layer and the native iOS SDK. Crashes, hangs and replay stay native; JS errors,
/// navigation and spans arrive as `RumEventV1` JSON and go through the same offline buffer and transport.
@objc(WatchtowerRN)
final class WatchtowerRN: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    /// `NativeModules.WatchtowerRN.appId`: the bundle id the JS layer sends as `X-Watchtower-App-Id`.
    @objc func constantsToExport() -> [AnyHashable: Any] { ["appId": Bundle.main.bundleIdentifier ?? ""] }

    @objc func start(_ options: NSDictionary) {
        guard let key = options["key"] as? String, let service = options["service"] as? String else { return }
        var c = Config(key: key, service: service)
        if let e = options["endpoint"] as? String { c.endpoint = e }
        c.release = options["release"] as? String
        c.environment = options["environment"] as? String
        if let n = options["crashLoopThreshold"] as? Int { c.crashLoopThreshold = max(1, n) }
        if let r = options["replay"] as? NSDictionary {
            c.replay.enabled = (r["enabled"] as? Bool) ?? false
            c.replay.maskText = (r["maskText"] as? Bool) ?? true
        }
        Watchtower.start(c) // no-op if the app already started it from AppDelegate
    }

    @objc func record(_ json: String) {
        guard let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let type = o["type"] as? String, let name = o["name"] as? String else { return }
        var e = Event(type: type, name: name, value: o["value"] as? Double, attrs: (o["attrs"] as? [String: Any]) ?? [:])
        if let id = o["id"] as? String { e.id = id }
        if let ts = o["ts_ns"] as? NSNumber { e.tsNs = ts.int64Value }
        Watchtower.shared.record(e)
    }

    /// The native crash-loop guard (DX 15); a JS fatal ends the process through the native handler, so it counts.
    @objc func crashLoop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
        resolve(["launchCrashCount": Watchtower.shared.launchCrashCount, "isCrashLooping": Watchtower.shared.isCrashLooping])
    }

    @objc func flush() { Watchtower.shared.flush() }
}
