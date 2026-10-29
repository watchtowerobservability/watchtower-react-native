'use strict';
// Expo config plugin. app.json: ["@watchtowerobservability/react-native", { "key": "wtp_...", "endpoint": "...",
//   "service": "app", "uploadSourceMaps": { "api": "https://api.example.com", "project": "my-project" } }]
// - exposes the (public) options to JS as expo-constants `extra.watchtower`
// - optionally adds an iOS build phase and an Android Gradle hook that upload Hermes source maps on release builds
//   (secret key from WT_API_KEY in the build environment; it is never written into the project).
const MARK = 'Watchtower source maps';
const SCRIPT = 'node_modules/@watchtowerobservability/react-native/scripts/upload-sourcemaps.js';

function gradleSnippet(up) {
  const args = `'--api', '${up.api}', '--project', '${up.project}'`;
  return `
// ${MARK}
afterEvaluate {
    ['Release'].each { variant ->
        def bundle = tasks.findByName("createBundle\${variant}JsAndAssets")
        if (bundle == null) return
        bundle.doLast {
            def metro = file("$buildDir/generated/sourcemaps/react/release/index.android.bundle.map")
            def hermes = file("$buildDir/intermediates/sourcemaps/react/release/index.android.bundle.hbc.map")
            if (!metro.exists()) return
            def cmd = ['node', '../../${SCRIPT}', '--bundle', 'index.android.bundle', '--map', metro.path, ${args}]
            if (hermes.exists()) cmd += ['--hermes-map', hermes.path]
            exec { commandLine cmd; ignoreExitValue true }
        }
    }
}
`;
}

function iosPhase(up) {
  return `set -e
[ -n "$WT_API_KEY" ] || { echo "watchtower: WT_API_KEY unset, skipping source map upload"; exit 0; }
MAP="\${SOURCEMAP_FILE:-$CONFIGURATION_BUILD_DIR/main.jsbundle.map}"
[ -f "$MAP" ] || exit 0
node "$SRCROOT/../${SCRIPT}" --bundle main.jsbundle --map "$MAP" --api "${up.api}" --project "${up.project}" || true`;
}

function withWatchtower(config, options = {}) {
  const { key, endpoint, service, environment, uploadSourceMaps: up } = options;
  if (!key || !String(key).startsWith('wtp_')) throw new Error('watchtower: the Expo plugin needs a publishable `key` (wtp_...)');
  config.extra = { ...config.extra, watchtower: { key, endpoint, service: service || config.slug, environment } };
  if (!up) return config;
  if (!up.api || !up.project) throw new Error('watchtower: uploadSourceMaps needs `api` and `project`');
  const plugins = require('@expo/config-plugins');
  config = plugins.withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(MARK)) c.modResults.contents += gradleSnippet(up);
    return c;
  });
  return plugins.withXcodeProject(config, (c) => {
    const proj = c.modResults;
    const has = Object.values(proj.hash.project.objects.PBXShellScriptBuildPhase || {}).some((p) => p && p.name && String(p.name).includes(MARK));
    if (!has) {
      proj.addBuildPhase([], 'PBXShellScriptBuildPhase', `"${MARK}"`, null, { shellPath: '/bin/sh', shellScript: iosPhase(up) });
    }
    return c;
  });
}

module.exports = withWatchtower;
module.exports.gradleSnippet = gradleSnippet;
module.exports.iosPhase = iosPhase;
