# @drakkar.software/octospaces-platform-sdk

Platform adapters for `@drakkar.software/octospaces-sdk` — KV persistence, vault storage (PIN + WebAuthn passkey), crypto setup, and an Argon2id shim for React Native.

## Installation

```bash
pnpm add @drakkar.software/octospaces-platform-sdk @drakkar.software/octospaces-sdk
```

Optional native peer deps (Expo / React Native only):

```bash
npx expo install expo-secure-store @react-native-async-storage/async-storage react-native-quick-crypto
```

## Overview

`octospaces-sdk` is platform-agnostic and ships no I/O. This package bridges it to the host environment:

| Concern | Web | Native |
|---------|-----|--------|
| Crypto | WebCrypto (built-in, no-op setup) | `react-native-quick-crypto` install |
| KV store | `localStorage` | `AsyncStorage` |
| Vault storage | AES-GCM + Argon2id PIN / WebAuthn PRF | `expo-secure-store` (OS keychain) |
| Passkeys | WebAuthn PRF | stubs (always false / throws) |
| Argon2id | `hash-wasm` (WASM) | pure-JS shim via `@noble/hashes` |

Metro resolves `.native.ts` automatically — no conditional imports needed in app code.

## Setup

Call once at app boot before any SDK API:

```ts
// Web
import { configureStarfishPlatform, kvGet, kvSet, kvRemove } from '@drakkar.software/octospaces-platform-sdk'
import { configureKv } from '@drakkar.software/octospaces-sdk'

configureStarfishPlatform()
configureKv({ get: kvGet, set: kvSet, remove: kvRemove })
```

```ts
// Native (same imports — Metro picks index.native.ts)
import { configureStarfishPlatform, kvGet, kvSet, kvRemove } from '@drakkar.software/octospaces-platform-sdk'
import { configureKv } from '@drakkar.software/octospaces-sdk'

configureStarfishPlatform() // installs react-native-quick-crypto
configureKv({ get: kvGet, set: kvSet, remove: kvRemove })
```

## Vault storage

The vault holds all local accounts under a single encrypted envelope. Unlock once, switch accounts freely without re-running Argon2id.

### Web

AES-GCM encryption with a Vault Master Key (VMK) held in a closure after unlock. The VMK can be sealed under a PIN (Argon2id-stretched) and/or a WebAuthn PRF passkey secret.

```ts
import { createVaultStorage } from '@drakkar.software/octospaces-platform-sdk'

const vaultStorage = createVaultStorage({ storageKey: 'myapp.session.v1' })

// Load existing vault
const state = await vaultStorage.loadVault()
// state.kind: 'none' | 'locked' | 'ready'

// Unlock with PIN
const vault = await vaultStorage.unlockVault('pin', myPin)

// Save with PIN protection
await vaultStorage.saveVault(vault, { pin: myPin })

// Add passkey unlock after enrollment
await vaultStorage.addPasskeyToVault(enrollment)

// Unlock with passkey
const vault = await vaultStorage.unlockVault('passkey')
```

> **Warning:** The `storageKey` is load-bearing. Changing it after deployment locks existing users out of their vaults.

### Native

`expo-secure-store` (OS Keychain / Android Keystore) handles encryption at rest. No PIN or VMK required — `loadVault()` always returns `{ kind: 'ready' }`.

```ts
import { createVaultStorageNative } from '@drakkar.software/octospaces-platform-sdk'

const vaultStorage = createVaultStorageNative()
const { vault } = await vaultStorage.loadVault()
await vaultStorage.saveVault(updatedVault)
```

## Passkeys (web only)

WebAuthn PRF extension — derives a stable 32-byte secret from a hardware authenticator, used to seal the VMK without a PIN.

```ts
import { passkeySupported, passkeyEnrollable, enrollPasskey, evalPasskey } from '@drakkar.software/octospaces-platform-sdk'

if (await passkeyEnrollable()) {
  const { credentialId, salt, secretHex } = await enrollPasskey('Alice', 'My App', 'myapp')
  // store credentialId + salt; secretHex seals the VMK
}

// Later, to unlock:
const { secretHex } = await evalPasskey(credentialId, saltHex)
```

On native all passkey functions return `false` or throw — biometric auth is handled at the OS level by `expo-secure-store`.

## Argon2id progress

PIN-based vault unlock runs Argon2id, which can take 30–120 seconds on slower devices. Subscribe to progress events to drive a UI indicator:

```ts
import { subscribeArgon2Progress } from '@drakkar.software/octospaces-platform-sdk'

const unsubscribe = subscribeArgon2Progress((pct) => {
  setProgress(pct) // 0–100
})
// call unsubscribe() when the unlock completes
```

## hash-wasm shim (React Native / Hermes)

Hermes does not ship WebAssembly, so `hash-wasm`'s Argon2id cannot run. Add a Metro resolver alias to redirect all `hash-wasm` imports to the pure-JS shim (byte-identical output via `@noble/hashes`):

```js
// metro.config.js
config.resolver.resolveRequest = (ctx, mod, plat) => {
  if (mod === 'hash-wasm') {
    return {
      type: 'sourceFile',
      filePath: require.resolve('@drakkar.software/octospaces-platform-sdk/hash-wasm-shim'),
    }
  }
  return ctx.resolveRequest(ctx, mod, plat)
}
```

## Security notes

- Seeds are **never** stored in cleartext. The web vault wraps them in AES-GCM under an Argon2id-stretched PIN and/or a WebAuthn PRF secret.
- All cryptographic operations happen **client-side**. The server stores only opaque ciphertext.
- After unlock the VMK lives in a closure, not in React state or sessionStorage — account mutations are fast (one AES-GCM op) without re-running Argon2id.

## ESM only

This package ships ESM only. Requires a bundler (Vite, Metro, etc.).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
