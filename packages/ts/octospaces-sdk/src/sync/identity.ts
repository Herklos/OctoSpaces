/**
 * Identity & 12-word recovery seed. The seed is a BIP-39 mnemonic used as the
 * passphrase for Starfish's `bootstrapRootIdentity`; the same words deterministically
 * recover the identity.
 */
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bootstrapRootIdentity, mintDeviceCap } from '@drakkar.software/starfish-identities';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { CapCert } from '@drakkar.software/starfish-protocol';

import { makeClient, ensureProfileKeys, ensurePseudo, type DeviceKeys } from './client.js';
import { accountScope, ownerScope } from './paths.js';
import { getSharedSpacesNamespace } from '../core/config.js';
import type { DerivedIdentity } from '../core/storage-types.js';

export interface Session {
  userId: string;
  name: string;
  keys: DeviceKeys;
  chatCap: unknown;
  accountCap: unknown;
  /**
   * The primary Starfish client for space content (keyring, channels, objects).
   * Uses the app's default namespace.
   */
  chatClient: StarfishClient;
  /**
   * The Starfish client for account-scoped content (profile, _spaces registry).
   * Uses the app's default namespace.
   */
  accountClient: StarfishClient;
  /**
   * Starfish client for cross-app shared-spaces registry operations.
   * When `sharedSpacesNamespace` is configured, uses that namespace override so
   * the spaces list lives in a separate namespace shared across multiple apps.
   * Falls back to `accountClient` when no shared namespace is configured.
   */
  spacesRegistryClient: StarfishClient;
  /**
   * Starfish client for cross-app shared-spaces keyring operations.
   * Same namespace logic as `spacesRegistryClient`, scoped to space content.
   * Falls back to `chatClient` when no shared namespace is configured.
   */
  spacesKeyringClient: StarfishClient;
  fingerprint: string;
  /**
   * The Ed25519 pubkey that signs this identity's OWNED-space keyring entries —
   * the trusted-adder provenance anchor for opening them.
   */
  ownerEdPub: string;
}

/**
 * Trusted-adder allow-list for opening an OWNED space's keyring.
 */
export function ownerTrustedAdders(session: Session): string[] {
  return session.ownerEdPub === session.keys.edPub
    ? [session.keys.edPub]
    : [session.ownerEdPub, session.keys.edPub];
}

/** Fresh 12-word recovery seed. */
export function generateSeedWords(): string[] {
  return generateMnemonic(wordlist, 128).split(' ');
}

export function isValidSeed(words: string[]): boolean {
  return validateMnemonic(words.join(' ').trim(), wordlist);
}

/** Human-readable fingerprint derived from the identity's user id. */
export function fingerprintFromUserId(userId: string): string {
  const h = userId.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return [h.slice(0, 4), h.slice(4, 8), h.slice(8, 12)].filter(Boolean).join(' · ');
}

/**
 * Build a full owner session (caps + clients + pseudo) from an already-derived
 * root identity. No Argon2id — only fast Ed25519 cap-minting plus a profile fetch.
 */
export async function buildSession({ userId, keys }: DerivedIdentity, name?: string): Promise<Session> {
  const fallback = name && name.trim() ? name.trim() : `user-${userId.slice(0, 6)}`;
  const sub = { edPubHex: keys.edPub, kemPubHex: keys.kemPub };
  const chatCap = await mintDeviceCap(keys.edPriv, keys.edPub, sub, ownerScope());
  const accountCap = await mintDeviceCap(keys.edPriv, keys.edPub, sub, accountScope(userId));
  const chatClient = makeClient(chatCap, keys.edPriv);
  const accountClient = makeClient(accountCap, keys.edPriv);

  const sharedNs = getSharedSpacesNamespace();
  const spacesRegistryClient = sharedNs ? makeClient(accountCap, keys.edPriv, sharedNs) : accountClient;
  const spacesKeyringClient = sharedNs ? makeClient(chatCap, keys.edPriv, sharedNs) : chatClient;

  const displayName = await ensurePseudo(accountClient, userId, fallback).catch(() => fallback);
  void ensureProfileKeys(accountClient, userId, keys).catch(() => {});
  return {
    userId,
    name: displayName,
    keys,
    chatCap,
    accountCap,
    chatClient,
    accountClient,
    spacesRegistryClient,
    spacesKeyringClient,
    fingerprint: fingerprintFromUserId(userId),
    ownerEdPub: keys.edPub,
  };
}

/** A paired device's credentials: its own keypair + the root-signed cap-cert. */
export interface LinkedIdentity {
  userId: string;
  keys: DeviceKeys;
  capCert: CapCert;
}

/**
 * Build a session for a PAIRED (linked) device. Unlike {@link buildSession}, the
 * device keypair is NOT the root, so it cannot self-mint caps — both clients are
 * driven by the single root-signed `capCert` from the pairing bundle.
 */
export async function buildLinkedSession({ userId, keys, capCert }: LinkedIdentity, name?: string): Promise<Session> {
  const fallback = name && name.trim() ? name.trim() : `user-${userId.slice(0, 6)}`;
  const chatClient = makeClient(capCert, keys.edPriv);
  const accountClient = makeClient(capCert, keys.edPriv);

  const sharedNs = getSharedSpacesNamespace();
  const spacesRegistryClient = sharedNs ? makeClient(capCert, keys.edPriv, sharedNs) : accountClient;
  const spacesKeyringClient = sharedNs ? makeClient(capCert, keys.edPriv, sharedNs) : chatClient;

  const displayName = await ensurePseudo(accountClient, userId, fallback).catch(() => fallback);
  return {
    userId,
    name: displayName,
    keys,
    chatCap: capCert,
    accountCap: capCert,
    chatClient,
    accountClient,
    spacesRegistryClient,
    spacesKeyringClient,
    fingerprint: fingerprintFromUserId(userId),
    ownerEdPub: capCert.iss,
  };
}

/** Derive a full owner session (identity + caps + clients) from a seed. */
export async function deriveSession(seedWords: string[], name?: string): Promise<Session> {
  const passphrase = seedWords.join(' ').trim();
  const creds = await bootstrapRootIdentity(passphrase);
  return buildSession({ userId: creds.userId, keys: creds.device as DeviceKeys }, name);
}

/** The cached root identity (userId + keys) carried by a built session. */
export function rootIdentityOf(s: Session): DerivedIdentity {
  return { userId: s.userId, keys: s.keys };
}
