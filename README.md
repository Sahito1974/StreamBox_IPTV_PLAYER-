# StreamBox IPTV starter — Milestone 2

Independent cross-platform IPTV player starter using React, Vite, hls.js, and Capacitor. It includes M3U/M3U8 import, common Xtream Codes API login/catalogue calls, HLS adaptive playback with a detected-quality selector, XMLTV/EPG import and schedule view, movies, and series episode lookup for providers implementing `get_series_info`.

Use only playlists, streams, and provider accounts you are legally authorized to access. This project does not include channels, subscriptions, paid provider access, or methods to bypass access controls. StreamBox is independent and is not affiliated with Titan IPTV Player.

## Requirements

- Node.js 20 or later and npm
- For Android packaging: Android Studio and Android SDK
- An authorized M3U playlist or compatible Xtream Codes provider for real-world testing

## Run on web

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production web build:

```bash
npm run build
npm run preview
```

## Prepare Android

```bash
npm install
npm run android:add
npm run android:sync
npm run android:open
```

In Android Studio, choose an emulator or device and run the app. Before release, configure your own application ID, signing key, app icon, privacy disclosures, and store listing.

## Milestone 2 features

- M3U playlist file import and URL fetch (remote URL fetch depends on provider CORS policy).
- Xtream-style login and retrieval of live, movie, and series catalogues using common `player_api.php` actions.
- HLS playback through hls.js when the stream URL is `.m3u8` and Media Source Extensions are supported.
- HLS quality selector based on variants actually advertised by the stream's master playlist. If the provider does not provide a 2160p/4K variant, the app cannot create real 4K quality by itself. Native playback may not expose manual quality levels.
- XMLTV file/URL import and a basic programme schedule. The app matches XMLTV channel IDs against playlist `tvg-id` values; if they do not match, guide entries may not appear. Uncompressed XMLTV XML is expected.
- Movies can be played when the provider returns valid stream URLs and the format is supported.
- Series metadata and episode lookup via `get_series_info` for compatible providers.
- Search, category filters, favourites, and a responsive web/mobile UI.

## Testing checklist

1. Start the web app with `npm run dev`.
2. Import a small M3U file containing a stream URL you control or are authorized to use. Confirm channels appear and search/favorites work.
3. Try a known HLS master playlist with multiple variants. Confirm the quality menu shows the variants advertised by that stream. Test a 2160p variant only if your source actually offers it and your network/device can decode it.
4. Import an XMLTV `.xml` file whose `<channel id="...">` matches a playlist `tvg-id="..."`. Open **Guide** and verify programme times. XMLTV timezone values are interpreted from their stated offset.
5. Use a compatible test Xtream provider to verify login, live streams, movies, and `get_series_info` episode loading.
6. Repeat on Android. Verify playback on the target Android version/device and test app resume, network loss, and invalid credentials.

## Production limitations and required hardening

- **Credentials are not secure in this starter.** Xtream credentials are saved with source data in browser `localStorage`. Do not use shared devices or publish this as-is. For a real release, design a secure backend/session model or use suitable secure platform storage, never log credentials, and protect provider requests.
- **CORS:** Browser fetch to remote playlists, XMLTV, and Xtream APIs may be blocked. If you implement a backend proxy, restrict it to trusted provider domains and defend against SSRF, credential leakage, abuse, and open-proxy use.
- **Provider compatibility varies.** Xtream endpoints, auth payloads, stream formats, and API features are not standardized. Test against the provider's documented and authorized API.
- **EPG:** This milestone imports uncompressed XMLTV and uses basic ID matching. Large guides may exceed localStorage limits; production should parse/store guide data more efficiently and support refresh/retention policies.
- **Series:** Episodes are loaded on demand, but episode metadata, artwork, resume position, seasons UX, and provider-specific formats still need refinement.
- **4K:** Resolution selection is only available when a stream exposes HLS variants and the browser/player can decode them. Bandwidth, device hardware, codec support, and provider authorization determine actual playback.
- **Premium plans/payments, cloud sync, profiles, parental controls, DRM, and production account security are not implemented.** Add entitlements server-side and follow relevant app-store billing rules if you offer subscriptions.
