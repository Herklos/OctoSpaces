# @drakkar.software/octospaces-platform-sdk

Platform adapters for `@drakkar.software/octospaces-sdk` — KV persistence, vault storage (PIN + WebAuthn passkey), crypto setup, and an Argon2id shim for React Native.

## Overview

The core `octospaces-sdk` is dependency-free and platform-agnostic. This package provides the I/O layer that connects it to the host environment:

| Module | Web | Native |
|--------|-----|--------|
| `kvGet / kvSet / kvRemove` | localStorage | AsyncStorage |
| `configureStarfishPlatform` | WebCrypto (no-op) | react-native-quick-crypto install |
| `passkeySupported / enrollPasskey / evalPasskey` | WebAuthn PRF | stubs (always false/throws) |
| `createVaultStorage` | AES-GCM + Argon2id PIN/passkey envelope | — |
| `createVaultStorageNative` | — | expo-secure-store |
| `subscribeArgon2Progress` (via `./hash-wasm-shim`) | — | progress emitter for pure-JS Argon2id |

## Installation

```sh
npm install @drakkar.software/octospaces-platform-sdk @drakkar.software/octospaces-sdk
```

Optional native peer deps (only needed for React Native / Expo builds):

```sh
npx expo install expo-secure-store @react-native-async-storage/async-storage react-native-quick-crypto
```

## Usage

### App boot (web)

```ts
import { configureKv } from '@drakkar.software/octospaces-sdk';
import { configureStarfishPlatform, kvGet, kvSet, kvRemove } from '@drakkar.software/octospaces-platform-sdk';

configureStarfishPlatform();
configureKv({ get: kvGet, set: kvSet, remove: kvRemove });
```

### Vault storage

```ts
import { createVaultStorage } from '@drakkar.software/octospaces-platform-sdk';

// Pass the EXACT key you used before (account lockout if wrong).
const vault = createVaultStorage({ storageKey: 'myapp.session.v1' });
const result = await vault.loadVault(); // { kind: 'none' | 'locked' | 'ready' }
```

### Passkey enrollment

```ts
import { enrollPasskey, evalPasskey } from '@drakkar.software/octospaces-platform-sdk';

const enrollment = await enrollPasskey('Alice', 'MyApp', 'myapp');
```

### Argon2id shim (React Native)

Configure your Metro bundler to redirect `hash-wasm` to this module:

```ts
// metro.config.js
config.resolver.resolveRequest = (ctx, mod, plat) => {
  if (mod === 'hash-wasm') return { type: 'sourceFile', filePath: require.resolve('@drakkar.software/octospaces-platform-sdk/hash-wasm-shim') };
  return ctx.resolveRequest(ctx, mod, plat);
};
```

## Security notes

- Seeds are **never** stored in cleartext. The web vault wraps them in AES-GCM under an Argon2id-stretched PIN and/or a WebAuthn PRF secret.
- All cryptographic operations happen **client-side**. The server stores only opaque ciphertext (`delegated` or `none` collections).
- The `storageKey` is load-bearing: changing it after deployment locks existing users out of their vaults.
