// React Native bridge to the native Android SDK (sdks/android, mirrored as watchtower-android).
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.watchtower.rn"
    compileSdk = 34
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.facebook.react:react-android")
    implementation("dev.watchtower:watchtower-android:0.1.0")
}
