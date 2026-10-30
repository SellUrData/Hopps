# Hopps

A mobile web app (installable PWA) that measures vertical jump height with the phone camera and keeps an analytics dashboard.

## How it works
- **Pose tracking**: MediaPipe Pose Landmarker (lite) runs on the device in the browser. No video ever leaves the phone.
- **Jump detection** (`src/lib/jumpDetector.ts`): finds the floor height of the toes while you stand still, flags takeoff when both feet rise above it, and on landing fits a ballistic parabola to the toe path in the air to get flight time `T`.
- **Height** = `g·T²/8`, the flight-time method used by contact mats and force plates. No calibration needed.
- **Storage**: `localStorage` on the device. Export as CSV, or back up and restore as JSON from Settings.

## Screens
- **Dashboard**: personal best, goal progress, avg of last 10 jumps, best in the last 7 days, progress since your first session, consistency, a per-session progress chart, a 14-day daily-best chart, the distribution of your jumps, and recent jumps. Filter by jump type.
- **Measure**: live camera with skeleton overlay, or upload a clip (supports slow-mo clips that play back slowed down).
- **History**: jumps grouped by session, with delete.
- **Settings**: units (in/cm), name, goal, default jump type, data export.

## Accuracy tips
Use a still camera at knee height with your whole body in frame. Stand still briefly before each jump and keep your legs straight in the air. Higher fps gives better accuracy; slow-mo (120/240 fps) uploads are the most accurate.

## Development
```bash
npm install        # also copies MediaPipe wasm + downloads the pose model (scripts/setup-assets.mjs)
npm run dev        # http://localhost:5173 (camera needs https or localhost)
npm test           # detector unit tests (synthetic jumps at 30–240 fps)
npm run build
```
Add `?debug` to the URL to expose the per-frame detector trace as `window.__vjTrace`.

## Shipping to the app stores
The app is a static site. Deploy `dist/` to any HTTPS host (Vercel, Netlify, Cloudflare Pages) and users can "Add to Home Screen". To publish native iOS/Android apps, wrap it with Capacitor (`@capacitor/core`, `@capacitor/ios`, `@capacitor/android`).

## Native apps (Capacitor)

`android/` and `ios/` are Capacitor projects wrapping the web build.

```bash
npm run build && npx cap sync          # copy web build into native projects
cd android && ./gradlew assembleDebug  # APK: android/app/build/outputs/apk/debug/app-debug.apk (JDK 21 + Android SDK)
npx cap open ios                       # macOS + Xcode: set signing team, then Run / Archive
```

Camera permission strings live in `android/app/src/main/AndroidManifest.xml` and `ios/App/App/Info.plist`.
Icons/splash are generated from `assets/` with `npx @capacitor/assets generate`.
