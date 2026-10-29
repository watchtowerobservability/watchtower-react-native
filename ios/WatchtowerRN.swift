import Foundation
import Watchtower

/// Bridge between the JS layer and the native iOS SDK. Crashes, hangs and replay stay native; JS errors,
/// navigation and spans arrive as `RumEventV1` JSON and go through the same offline buffer and transport.
@objc(WatchtowerRN)
final class WatchtowerRN: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc func start(_ options: NSDictionary) {
        guard let key = options["key"] as? String, let service = options["service"] as? String else { return }
        var c = Config(key: key, service: service)
        if let e = options["endpoint"] as? String { c.endpoint = e }
        c.release = options["release"] as? String
        c.environment = options["environment"] as? String
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

    @objc func flush() { Watchtower.shared.flush() }
}
