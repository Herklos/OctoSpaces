/** Web platform barrel. */
export { configureStarfishPlatform } from './platform.js';
export { kvGet, kvSet, kvRemove } from './kv.js';
export { passkeySupported, passkeyEnrollable, enrollPasskey, evalPasskey } from './passkey.js';
export { createVaultStorage } from './storage.js';
export type { VaultStorage } from './storage.js';
export { subscribeArgon2Progress } from './hash-wasm-shim.js';
