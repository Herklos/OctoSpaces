/**
 * Persisted accounts on native — the {@link Vault} (every account's recovery seed +
 * which is active) in the device Keychain/Keystore via expo-secure-store, which
 * encrypts at rest. There is no PIN/passkey/VMK here (that's the web path in
 * storage.ts): the OS already protects the store, so the vault restores directly and
 * `status` is never 'locked'. Switching/adding/removing an account just rewrites the
 * one secure-store entry.
 */
// @ts-ignore — optional peer dep; only present in native builds
import * as SecureStore from 'expo-secure-store';

import type {
  PasskeyEnrollment,
  PersistedSession,
  SeedLock,
  UnlockMethod,
  Vault,
  VaultLoad,
} from '@drakkar.software/octospaces-sdk';

type SS = { setItemAsync(k: string, v: string): Promise<void>; getItemAsync(k: string): Promise<string | null>; deleteItemAsync(k: string): Promise<void> };
const SS = SecureStore as unknown as SS;

export interface VaultStorageNative {
  loadVault(): Promise<VaultLoad>;
  vaultMethods(): UnlockMethod[];
  unlockVault(method: UnlockMethod, pin?: string): Promise<Vault>;
  saveVault(vault: Vault, lock?: SeedLock): Promise<void>;
  addPasskeyToVault(passkey: PasskeyEnrollment): Promise<void>;
  removePasskeyFromVault(): Promise<void>;
  clearVault(): Promise<void>;
  passkeySupported(): boolean;
}

/** Create a native vault storage instance bound to the given secure-store key. */
export function createVaultStorageNative({ storageKey }: { storageKey: string }): VaultStorageNative {
  function asVault(raw: string): Vault | null {
    try {
      const obj = JSON.parse(raw) as Partial<Vault> & Partial<PersistedSession>;
      if (Array.isArray(obj.accounts)) return obj as Vault;
      // Legacy single-account entry (a bare PersistedSession): wrap it.
      if (Array.isArray(obj.seed)) {
        const session = obj as PersistedSession;
        return { accounts: [session], activeId: session.derived?.userId ?? '' };
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  async function saveVault(v: Vault, _lock?: SeedLock): Promise<void> {
    try {
      await SS.setItemAsync(storageKey, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }

  async function loadVault(): Promise<VaultLoad> {
    try {
      const raw = await SS.getItemAsync(storageKey);
      if (!raw) return { kind: 'none' };
      const vault = asVault(raw);
      if (!vault || vault.accounts.length === 0) return { kind: 'none' };
      return { kind: 'ready', vault };
    } catch (error) {
      // A read error is NOT "no account" — the vault is still in Keychain. Returning
      // 'none' here caused cold-start welcome-screen flashes (the user's identity
      // appeared wiped). Surface the error so the caller can keep the splash up.
      console.error('[storage.native] loadVault failed', error);
      return { kind: 'error', error };
    }
  }

  // Native restores directly from the Keychain — there is no lock screen to unlock.
  async function unlockVault(_method: UnlockMethod, _pin?: string): Promise<Vault> {
    throw new Error('unlockVault is not used on native.');
  }

  // Passkeys are a web-vault concept (storage.ts). Native has no PIN/VMK to wrap, so the
  // app-lock here is OS biometrics, not a passkey. These keep the cross-platform contract
  // so session-context can call them unconditionally.
  async function addPasskeyToVault(_passkey: PasskeyEnrollment): Promise<void> {
    throw new Error('Passkeys are not used on native.');
  }

  async function removePasskeyFromVault(): Promise<void> {
    /* no passkey wrap on native — nothing to remove */
  }

  // No app-lock on native (the OS protects the store), so there is nothing to re-prompt.
  function vaultMethods(): UnlockMethod[] {
    return [];
  }

  async function clearVault(): Promise<void> {
    try {
      await SS.deleteItemAsync(storageKey);
    } catch {
      /* ignore */
    }
  }

  return {
    loadVault,
    vaultMethods,
    unlockVault,
    saveVault,
    addPasskeyToVault,
    removePasskeyFromVault,
    clearVault,
    passkeySupported: () => false,
  };
}
