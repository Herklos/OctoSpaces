# Changelog

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
