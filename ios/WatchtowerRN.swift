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
    /// `stopped`: a denial persisted by `stop()`; the JS layer then starts denied unless the app grants consent explicitly.
    @objc func constantsToExport() -> [AnyHashable: Any] { ["appId": Bundle.main.bundleIdentifier ?? "", "stopped": Self.stopped] }

    private static let stoppedKey = "wt_rn_stopped"
    private static var stopped: Bool { UserDefaults.standard.bool(forKey: stoppedKey) }

    /// The crash report buffer and the offline event buffer (same Caches paths the native SDK uses).
    private static func wipe() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        for d in ["wt-crash", "wt-offline"] { try? FileManager.default.removeItem(at: caches.appendingPathComponent(d)) }
    }

    /// Consent denied: remove the exception and signal handlers the native SDK installed, delete the buffers, persist the denial.
    @objc func stop() {
        UserDefaults.standard.set(true, forKey: Self.stoppedKey)
        NSSetUncaughtExceptionHandler(nil)
        for s in [SIGSEGV, SIGABRT, SIGBUS, SIGILL, SIGTRAP, SIGFPE] { signal(s, SIG_DFL) }
        Self.wipe()
    }

    @objc func start(_ options: NSDictionary) {
        guard let key = options["key"] as? String, let service = options["service"] as? String else { return }
        if (options["consent"] as? String) == "granted" { UserDefaults.standard.set(false, forKey: Self.stoppedKey) }
        if Self.stopped { Self.wipe(); return }
        var c = Config(key: key, service: service)
        if let e = options["endpoint"] as? String { c.endpoint = e }
        c.release = options["release"] as? String
        c.environment = options["environment"] as? String
        if let n = options["crashLoopThreshold"] as? Int { c.crashLoopThreshold = max(1, n) }
        if let v = options["trackViews"] as? Bool { c.trackViews = v }
        if let v = options["trackNetwork"] as? Bool { c.trackNetwork = v }
        if let v = options["hangThresholdMs"] as? Double, v > 0 { c.hangThreshold = v / 1000 }
        if let v = options["propagateTo"] as? [String] { c.propagateTo = v }
        c.buildId = options["buildId"] as? String
        if let v = options["profileLaunch"] as? Bool { c.profileLaunch = v }
        if let r = options["replay"] as? NSDictionary {
            c.replay.enabled = (r["enabled"] as? Bool) ?? false
            c.replay.maskText = (r["maskText"] as? Bool) ?? true
            if (r["mode"] as? String) == "wireframe" { c.replay.mode = .wireframe }
        }
        Watchtower.start(c) // no-op if the app already started it from AppDelegate
    }

    @objc func record(_ json: String) {
        if Self.stopped { return }
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
