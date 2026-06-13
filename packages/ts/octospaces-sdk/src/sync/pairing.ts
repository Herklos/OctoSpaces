/**
 * Device pairing (one-way, PIN-sealed). The existing device provisions a new
 * device's keypair + cap bundle, seals it with the PIN (Argon2id → AES-GCM), and
 * drops it on the public `_pairing/<nonce>` rendezvous. The QR carries only the
 * nonce; the new device fetches the sealed blob, opens it with the PIN, and
 * validates the cap bundle.
 */
import { StarfishClient } from '@drakkar.software/starfish-client';
import {
  installPairingBundle,
  openWithPassphrase,
  provisionDevice,
  sealWithPassphrase,
} from '@drakkar.software/starfish-identities';
import type { CapCert } from '@drakkar.software/starfish-protocol';

import type { DeviceKeys } from './client.js';
import { getSyncBase, getSyncNamespace } from '../core/config.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import type { Session } from './identity.js';
import { fingerprintFromUserId } from './identity.js';
import { bytesToHex, linkedDeviceScope } from './paths.js';

/** The QR-payload prefix this SDK uses. Kept distinct from `octochat-pair:` so apps
 *  can route QR payloads to the correct handler during their migration window. */
export const PAIR_PREFIX = 'octospaces-pair:';

// Linked-device cap-cert lifetime — one year keeps a linked device usable long-term.
const LINKED_DEVICE_TTL_SEC = 365 * 24 * 60 * 60;

function anonClient(): StarfishClient {
  return new StarfishClient({ baseUrl: getSyncBase(), namespace: getSyncNamespace(), fetch: fetchWithTimeout() });
}

function randomNonce(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}

/**
 * Existing device: provision + PIN-seal a new device, publish to rendezvous, return
 * the QR payload.
 *
 * After pairing, call `addDeviceToSpaceKeyring(session, spaceId, newDeviceKeys)` for
 * each space whose E2EE content the new device should decrypt. ONE space keyring
 * encrypts ALL `enc` nodes in a space — one call per space unlocks everything.
 * Plaintext (`space` / `public`) nodes are immediately accessible via the linked-device
 * cap-cert (no extra keyring step).
 */
export async function startDevicePairing(session: Session, pin: string): Promise<string> {
  const { deviceKeys, bundle } = await provisionDevice(
    { edPriv: session.keys.edPriv, edPub: session.keys.edPub },
    { scope: linkedDeviceScope(session.userId), ttlSec: LINKED_DEVICE_TTL_SEC },
  );
  const blob = JSON.stringify({ v: 1, keys: deviceKeys, bundle });
  const sealed = await sealWithPassphrase(pin, new TextEncoder().encode(blob));
  const nonce = randomNonce();
  await anonClient().push(`/push/_pairing/${nonce}`, sealed as unknown as Record<string, unknown>, null);
  return `${PAIR_PREFIX}${nonce}.${session.keys.edPub}`;
}

export interface PairResult {
  userId: string;
  fingerprint: string;
  deviceKeys: DeviceKeys;
  capCert: CapCert;
}

/** New device: fetch the sealed blob by nonce, open with PIN, validate the bundle. */
export async function completeDevicePairing(payload: string, pin: string): Promise<PairResult> {
  // Accept both `octospaces-pair:` and legacy `octochat-pair:` so apps still using the
  // old QR format can complete a pairing against this SDK during the migration window.
  const body = (payload.startsWith(PAIR_PREFIX) || payload.includes('-pair:')
    ? payload.slice(payload.indexOf(':') + 1)
    : payload).trim();
  const [nonce, expectedRootEdPub] = body.split('.');
  const res = await anonClient().pull(`/pull/_pairing/${nonce}`).catch(() => null);
  const sealed = res?.data as Record<string, unknown> | undefined;
  if (!sealed || !sealed.v) throw new Error('Pairing code not found or expired.');
  let inner: Uint8Array;
  try {
    inner = await openWithPassphrase(pin, sealed as never);
  } catch {
    throw new Error('Wrong PIN or corrupted pairing code.');
  }
  const blob = JSON.parse(new TextDecoder().decode(inner)) as { keys: unknown; bundle: unknown };
  const opts = (expectedRootEdPub ? { expectedRootEdPub } : {}) as Parameters<typeof installPairingBundle>[2];
  const installed = await installPairingBundle(
    blob.bundle as Parameters<typeof installPairingBundle>[0],
    blob.keys as Parameters<typeof installPairingBundle>[1],
    opts,
  );
  const userId = installed.credentials.userId;
  return {
    userId,
    fingerprint: fingerprintFromUserId(userId),
    deviceKeys: installed.credentials.device,
    capCert: installed.credentials.capCert,
  };
}
