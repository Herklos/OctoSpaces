# Changelog

## 0.3.4 (2026-06-26)

### Changed

Starfish peer and dev dependencies updated to `3.0.0-alpha.43` (was alpha.40).
No API or behaviour changes.

## 0.3.3 (2026-06-26)

### Changed

Starfish peer and dev dependencies updated to `3.0.0-alpha.40` (`starfish-identities`,
`starfish-protocol`). No API or behaviour changes.

## 0.3.2 (2026-06-24)

_(interim patch bump — see git history)_

## 0.3.1 (2026-06-24)

### Fixed

- **Argon2id progress bar now moves on React Native / Hermes.** `@noble/hashes`'
  `nextTick` was a microtask no-op that never unblocked the React / Reanimated paint
  loop during derivation — `subscribeArgon2Progress` listeners received updates but
  the UI could not repaint until the JS thread was fully released. Fixed via a pnpm
  patch that replaces `nextTick` with a real `setTimeout(0)` macrotask yield.
  `asyncTick` on the `argon2idAsync` call is also raised to 50 ms (~20 fps) to
  cap the number of `setTimeout` roundtrips over a 30–120 s derivation.

## 0.1.0 (2026-06-16)

Initial release — extracted from `OctoChat` and `OctoVault` app-SDKs.

### Added

- `kvGet / kvSet / kvRemove` — async KV over localStorage (web) and AsyncStorage (native)
- `configureStarfishPlatform` — registers chunked base64 provider + installs `react-native-quick-crypto` on native
- `passkeySupported / passkeyEnrollable / enrollPasskey / evalPasskey` — WebAuthn PRF passkey unlock (web); stubs on native
- `createVaultStorage({ storageKey })` — web vault factory: AES-GCM envelope, PIN (Argon2id) + optional passkey unlock, v3→v4 migration
- `createVaultStorageNative({ storageKey })` — native vault factory backed by `expo-secure-store`
- `subscribeArgon2Progress` (via `./hash-wasm-shim` subpath) — progress emitter for pure-JS Argon2id on Hermes
- `argon2id` (via `./hash-wasm-shim`) — `@noble/hashes` implementation, drop-in for `hash-wasm`
