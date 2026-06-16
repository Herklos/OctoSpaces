/** Native platform barrel. */
export { configureStarfishPlatform } from './platform.native.js';
export { kvGet, kvSet, kvRemove } from './kv.native.js';
export { passkeySupported, passkeyEnrollable, enrollPasskey, evalPasskey } from './passkey.native.js';
export { createVaultStorageNative } from './storage.native.js';
export type { VaultStorageNative } from './storage.native.js';
export { subscribeArgon2Progress } from './hash-wasm-shim.js';
