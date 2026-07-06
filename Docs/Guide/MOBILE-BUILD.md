# Mobile App — Build & Run Guide (Android)

How to build and run the Jetty Planning Android app. The app is the existing React
frontend wrapped with [Capacitor](https://capacitorjs.com/); it reuses the same backend.

> The dev container used to scaffold this has Node but **no Android toolchain**, so the
> APK must be compiled on a machine with the tools below (or in CI).

## 1. Prerequisites (build machine)

- **Node.js 18+** and npm (already used for the web app)
- **JDK 17** (Temurin/Adoptium recommended)
- **Android Studio** (bundles the Android SDK, platform-tools, and an emulator), or the
  standalone **Android SDK command-line tools**
- Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to the SDK path and add
  `platform-tools` to `PATH` (gives you `adb`).

Verify: `java -version`, `adb version`, and in Android Studio install an SDK Platform
(API 34+) + Build-Tools.

## 2. Configure the backend URL

The app talks to the backend over an **absolute** URL baked in at build time.

```bash
cd Frontend
cp .env.mobile.example .env.mobile
# edit .env.mobile → VITE_API_BASE_URL=https://<your-api-host>/api/v1
```

- Production: use **HTTPS**.
- Pilot on a private IP over HTTP works because `capacitor.config.json` sets
  `cleartext: true` / `allowMixedContent: true`. Tighten this for production.

## 3. Backend one-time config (no code change)

On the API server, set:

```
AUTH_RETURN_TOKEN_BODY=true          # login returns the JWT in the body for the app
CORS_ORIGIN=...,https://localhost,capacitor://localhost   # allow the WebView origin
```

The web app is unaffected (it keeps using cookies + CSRF).

## 4. Build the web bundle + sync into Android

```bash
cd Frontend
npm install                 # first time only
npm run build:mobile        # vite build using .env.mobile
npm run cap:sync            # copy dist/ into android/ and update native plugins
```

## 5. Produce an APK

**Option A — Android Studio (recommended for first run):**
```bash
npm run cap:open            # opens the android/ project in Android Studio
```
Then Build ▸ Build Bundle(s)/APK(s) ▸ Build APK, or press Run to deploy to a
device/emulator.

**Option B — command line (debug APK):**
```bash
npm run mobile:apk          # build:mobile + cap sync + gradlew assembleDebug
# APK output: Frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a connected device: `adb install -r app-debug.apk`.

## 6. Release (signed) APK/AAB — for distribution

1. Create a keystore (once), keep it **out of git** (already gitignored):
   ```bash
   keytool -genkey -v -keystore jps-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias jps
   ```
2. Add signing config to `android/app/build.gradle` (or `~/.gradle/gradle.properties`).
3. Build: `cd android && gradlew.bat assembleRelease` (APK) or `bundleRelease` (AAB).
4. **Sideloaded (v1):** distribute `app-release.apk` (users enable "install unknown apps").
   **Google Play (later):** upload the `.aab` to a private/managed Play listing.

## 7. Iterating

After any frontend change: `npm run build:mobile && npm run cap:sync`, then rebuild/run.
No native code changes are needed for normal UI/logic work.

## Notes

- Routing uses `HashRouter` inside the app automatically (web keeps clean URLs).
- Auth uses a Bearer token stored in secure storage; offline features land in later phases
  (see `Docs/Plan/ANDROID-MOBILE-APP-OFFLINE-PLAN.md`).
- `JettyLive` (RTSP video) requires connectivity and won't work offline.
