package dev.watchtower.rn

import android.app.Application
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import dev.watchtower.Config
import dev.watchtower.DEFAULT_ENDPOINT
import dev.watchtower.Event
import dev.watchtower.ReplayConfig
import dev.watchtower.ReplayMode
import dev.watchtower.Watchtower
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Bridge to the native Android SDK: crashes, ANRs and replay stay native, JS events join the same buffer. */
class WatchtowerRNModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "WatchtowerRN"

    /** `NativeModules.WatchtowerRN.appId`: the package name the JS layer sends as `X-Watchtower-App-Id`. */
    /** `stopped`: a denial persisted by `stop()`; the JS layer then starts denied unless the app grants consent explicitly. */
    override fun getConstants(): Map<String, Any> = mapOf("appId" to reactApplicationContext.packageName, "stopped" to stopped)

    private val prefs get() = reactApplicationContext.getSharedPreferences("wt_rn", Context.MODE_PRIVATE)
    private var stopped: Boolean
        get() = prefs.getBoolean("stopped", false)
        set(v) { prefs.edit().putBoolean("stopped", v).apply() }
    private var prevHandler: Thread.UncaughtExceptionHandler? = null

    /** The native crash report and the offline event buffer (same filesDir paths the native SDK uses). */
    private fun wipe() {
        val dir = reactApplicationContext.filesDir
        File(dir, "wt-native-crash.txt").delete()
        File(dir, "wt-offline").deleteRecursively()
    }

    /**
     * Consent denied: put back the JVM uncaught-exception handler that was installed before the native SDK started,
     * delete the buffers and persist the denial. The NDK signal handler cannot be removed from here (the native SDK has
     * no stop API); it may write a report until the process exits, which the next start deletes.
     */
    @ReactMethod
    fun stop() {
        stopped = true
        prevHandler?.let { Thread.setDefaultUncaughtExceptionHandler(it) }
        wipe()
    }

    private fun ReadableMap.optBool(k: String, d: Boolean) = if (hasKey(k) && !isNull(k)) getBoolean(k) else d

    @ReactMethod
    fun start(o: ReadableMap) {
        val key = o.getString("key") ?: return
        val service = o.getString("service") ?: return
        if (o.getString("consent") == "granted") stopped = false
        if (stopped) { wipe(); return }
        val replay = if (o.hasKey("replay") && !o.isNull("replay")) o.getMap("replay") else null
        val cfg = Config(
            key = key,
            service = service,
            endpoint = o.getString("endpoint") ?: DEFAULT_ENDPOINT,
            release = o.getString("release"),
            environment = o.getString("environment"),
            replay = ReplayConfig(
                enabled = replay?.takeIf { it.hasKey("enabled") }?.getBoolean("enabled") ?: false,
                maskText = replay?.takeIf { it.hasKey("maskText") }?.getBoolean("maskText") ?: true,
                mode = if (replay?.takeIf { it.hasKey("mode") }?.getString("mode") == "wireframe") ReplayMode.WIREFRAME else ReplayMode.SCREENSHOT,
            ),
            trackViews = o.optBool("trackViews", true),
            anrThresholdMs = if (o.hasKey("hangThresholdMs") && !o.isNull("hangThresholdMs")) o.getDouble("hangThresholdMs").toLong() else 5000L,
            propagateTo = if (o.hasKey("propagateTo") && !o.isNull("propagateTo")) {
                o.getArray("propagateTo")!!.toArrayList().filterIsInstance<String>()
            } else {
                emptyList()
            },
            profileLaunch = o.optBool("profileLaunch", false),
            buildId = o.getString("buildId"),
            crashLoopThreshold = if (o.hasKey("crashLoopThreshold") && !o.isNull("crashLoopThreshold")) {
                o.getInt("crashLoopThreshold").coerceAtLeast(1)
            } else {
                2
            },
        )
        if (prevHandler == null) prevHandler = Thread.getDefaultUncaughtExceptionHandler()
        Watchtower.init(reactApplicationContext.applicationContext as Application, cfg) // no-op if already initialised
    }

    @ReactMethod
    fun record(json: String) {
        if (stopped) return
        val o = runCatching { JSONObject(json) }.getOrNull() ?: return
        val attrs = mutableMapOf<String, Any>()
        o.optJSONObject("attrs")?.let { a -> a.keys().forEach { k -> attrs[k] = a.get(k) } }
        Watchtower.record(
            Event(
                type = o.optString("type"),
                name = o.optString("name"),
                value = if (o.has("value")) o.getDouble("value") else null,
                attrs = attrs,
                tsNs = o.optLong("ts_ns", System.currentTimeMillis() * 1_000_000L),
                id = o.optString("id", UUID.randomUUID().toString()),
            ),
        )
    }

    /** The native crash-loop guard (DX 15); a JS fatal ends the process through the native handler, so it counts. */
    @ReactMethod
    fun crashLoop(p: Promise) {
        p.resolve(
            Arguments.createMap().apply {
                putInt("launchCrashCount", Watchtower.launchCrashCount)
                putBoolean("isCrashLooping", Watchtower.isCrashLooping)
            },
        )
    }

    @ReactMethod
    fun flush() { /* the native transport flushes on its own 10 s timer and at next start */ }
}
