package dev.watchtower.rn

import android.app.Application
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import dev.watchtower.Config
import dev.watchtower.DEFAULT_ENDPOINT
import dev.watchtower.Event
import dev.watchtower.ReplayConfig
import dev.watchtower.Watchtower
import org.json.JSONObject
import java.util.UUID

/** Bridge to the native Android SDK: crashes, ANRs and replay stay native, JS events join the same buffer. */
class WatchtowerRNModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "WatchtowerRN"

    @ReactMethod
    fun start(o: ReadableMap) {
        val key = o.getString("key") ?: return
        val service = o.getString("service") ?: return
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
            ),
        )
        Watchtower.init(reactApplicationContext.applicationContext as Application, cfg) // no-op if already initialised
    }

    @ReactMethod
    fun record(json: String) {
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

    @ReactMethod
    fun flush() { /* the native transport flushes on its own 10 s timer and at next start */ }
}
