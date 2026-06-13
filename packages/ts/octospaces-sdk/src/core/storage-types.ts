/**
 * Shared types for the persisted-session storage layer. Both platform variants
 * (`storage.ts` web, `storage.native.ts` native) implement the same contract so
 * the session context stays platform-agnostic.
 */
import type { BootstrapOrigin } from '@drakkar.software/starfish-identities';
import type { CapCert } from '@drakkar.software/starfish-protocol';

import type { DeviceKeys } from '../sync/client.js';

/**
 * The root identity already derived from the seed (userId + device keys). Caching
 * it lets unlock/cold-start skip the heavy `bootstrapRootIdentity` Argon2id.
 * Equivalent in sensitivity to the seed, so it lives inside the same sealed blob.
 */
export interface DerivedIdentity {
  userId: string;
  keys: DeviceKeys;
}

/** The recovery seed + display name — the minimum needed to re-derive an identity. */
export interface PersistedSession {
  /** BIP-39 recovery seed. Absent for non-seed origins. */
  seed?: string[];
  name: string;
  /** Cached root identity so restore skips the bootstrap Argon2id. */
  derived?: DerivedIdentity;
  /** How this identity was bootstrapped. Absent for seed-derived identities. */
  bootstrapOrigin?: BootstrapOrigin;
  /** Root-signed cap-cert for a PAIRED (linked) device. */
  capCert?: CapCert;
}

/**
 * Every account held on this device plus which one is active. The whole vault is
 * sealed as a unit (web: under one app-lock via a vault master key; native: a
 * single secure-store entry).
 */
export interface Vault {
  accounts: PersistedSession[];
  activeId: string;
}

/** Ways the web-persisted seed can be unlocked. */
export type UnlockMethod = 'pin' | 'passkey';

/** A registered passkey + the PRF secret used to seal the seed for it. */
export interface PasskeyEnrollment {
  credentialId: string;
  salt: string;
  secretHex: string;
}

/** How to lock the seed when persisting it (web only). */
export interface SeedLock {
  pin: string;
  passkey?: PasskeyEnrollment;
}

/**
 * Result of probing storage at launch:
 * - `none`   — nothing stored; start signed-out.
 * - `ready`  — vault available immediately (native Keychain path).
 * - `locked` — a sealed vault exists; unlock with one of `methods` (web path).
 * - `error`  — storage read failed.
 */
export type VaultLoad =
  | { kind: 'none' }
  | { kind: 'ready'; vault: Vault }
  | { kind: 'locked'; methods: UnlockMethod[] }
  | { kind: 'error'; error: unknown };
