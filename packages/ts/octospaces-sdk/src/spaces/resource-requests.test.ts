/**
 * Pure-crypto unit tests for the identity-link + resource-request inbox primitives.
 *
 * No mocks on the crypto layer and no live server — these exercise the real
 * @drakkar.software/starfish-identities and @drakkar.software/starfish-keyring
 * primitives so that if the seal, identity derivation, or binding check breaks,
 * the tests fail loudly.
 *
 * Live-server round-trips (submitResourceRequest → appendToInbox → scanResourceRequests
 * → acceptResourceRequest) are not covered here — they require a running Starfish
 * server and belong in an end-to-end example (examples/create-ticket/ts/).
 */
import { describe, it, expect } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { hexToBytes, bytesToHex } from '@drakkar.software/starfish-keyring';
import { ed25519 } from '@noble/curves/ed25519.js';

import {
  encodeIdentityLink,
  decodeIdentityLink,
  verifyIdentityLinkBinding,
} from './identity-link.js';
import type { IdentityLink } from './identity-link.js';
import {
  sealToRecipient,
  unsealFromRecipient,
} from '../sync/account-seal.js';
import { userIdFromEdPub } from '../sync/paths.js';

/** Build a valid v:2 IdentityLink for the given keys. */
function makeIdentityLink(keys: ReturnType<typeof generateDeviceKeys>, userId: string, pseudo: string): IdentityLink {
  const kemSig = bytesToHex(ed25519.sign(hexToBytes(keys.kemPub), hexToBytes(keys.edPriv)));
  return { v: 2, ownerId: userId, pseudo, edPub: keys.edPub, kemPub: keys.kemPub, kemSig };
}

// Minimal Session stub — only the fields used by seal/unseal and link helpers.
async function makeStubSession(keys: ReturnType<typeof generateDeviceKeys>) {
  const userId = await userIdFromEdPub(keys.edPub);
  return {
    userId,
    name: `user-${userId.slice(0, 6)}`,
    keys,
    ownerEdPub: keys.edPub,
    // The remaining Session fields (clients, caps, etc.) are never called by the
    // pure-crypto path we're testing here.
  } as unknown as import('../sync/identity.js').Session;
}

// ── identity-link: encode / decode / binding ──────────────────────────────────

describe('IdentityLink — encode / decode / binding', () => {
  it('round-trips: decode(encode(token)) === token', async () => {
    const keys = generateDeviceKeys();
    const userId = await userIdFromEdPub(keys.edPub);
    const token = makeIdentityLink(keys, userId, 'Alice');
    const link = encodeIdentityLink('https://example.com', 'request', token);
    // Fragment is after '#'
    const frag = link.slice(link.indexOf('#'));
    const decoded = decodeIdentityLink(frag);
    expect(decoded.ownerId).toBe(token.ownerId);
    expect(decoded.edPub).toBe(token.edPub);
    expect(decoded.kemPub).toBe(token.kemPub);
    expect(decoded.pseudo).toBe(token.pseudo);
    expect(decoded.kemSig).toBe(token.kemSig);
    expect(decoded.v).toBe(2);
  });

  it('decodeIdentityLink strips leading # from fragment', async () => {
    const keys = generateDeviceKeys();
    const userId = await userIdFromEdPub(keys.edPub);
    const token = makeIdentityLink(keys, userId, '');
    const link = encodeIdentityLink('https://example.com', 'request', token);
    const fragWithHash = link.slice(link.indexOf('#')); // includes '#'
    const fragNoHash = fragWithHash.slice(1);            // without '#'
    expect(decodeIdentityLink(fragWithHash)).toEqual(decodeIdentityLink(fragNoHash));
  });

  it('verifyIdentityLinkBinding passes for a correct token', async () => {
    const keys = generateDeviceKeys();
    const userId = await userIdFromEdPub(keys.edPub);
    const token = makeIdentityLink(keys, userId, 'Bob');
    expect(await verifyIdentityLinkBinding(token)).toBe(true);
  });

  it('verifyIdentityLinkBinding fails when ownerId is tampered', async () => {
    const keys = generateDeviceKeys();
    const userId = await userIdFromEdPub(keys.edPub);
    // Flip one character
    const tampered = userId.slice(0, -1) + (userId.endsWith('0') ? '1' : '0');
    const token = { ...makeIdentityLink(keys, userId, 'Eve'), ownerId: tampered };
    expect(await verifyIdentityLinkBinding(token)).toBe(false);
  });

  it('verifyIdentityLinkBinding fails when edPub is replaced by a different key', async () => {
    const keys = generateDeviceKeys();
    const other = generateDeviceKeys();
    const userId = await userIdFromEdPub(keys.edPub);
    // ownerId matches keys.edPub but edPub is now other.edPub — binding breaks
    // kemSig is for keys, but edPub is other.edPub → sig verification will also fail
    const kemSig = bytesToHex(ed25519.sign(hexToBytes(keys.kemPub), hexToBytes(keys.edPriv)));
    const token: IdentityLink = { v: 2, ownerId: userId, pseudo: 'Eve', edPub: other.edPub, kemPub: other.kemPub, kemSig };
    expect(await verifyIdentityLinkBinding(token)).toBe(false);
  });

  it('decodeIdentityLink throws on malformed base64url', () => {
    expect(() => decodeIdentityLink('not-valid-base64url!!!')).toThrow();
  });

  it('decodeIdentityLink throws on missing required fields', async () => {
    const partial = { v: 2, ownerId: 'a'.repeat(32), edPub: 'b'.repeat(64) }; // kemPub and kemSig missing
    const { toBase64Url } = await import('../sync/base64.js');
    const frag = toBase64Url(JSON.stringify(partial));
    expect(() => decodeIdentityLink(frag)).toThrow();
  });
});

// ── Seal / unseal round-trip (ResourceRequest payload crypto) ─────────────────

describe('ResourceRequest seal / unseal round-trip', () => {
  it('owner can unseal a request sealed by the requester', async () => {
    const requesterKeys = generateDeviceKeys();
    const ownerKeys = generateDeviceKeys();
    const requesterSession = await makeStubSession(requesterKeys);
    const ownerSession = await makeStubSession(ownerKeys);

    const payload = {
      v: 1 as const,
      kind: 'create-resource' as const,
      reqId: 'test-req-1',
      spaceId: 'sp-test',
      nodeType: 'ticket',
      title: 'Bug report',
      requester: {
        userId: requesterSession.userId,
        edPub: requesterKeys.edPub,
        kemPub: requesterKeys.kemPub,
      },
    };

    const sealed = await sealToRecipient(requesterSession, ownerKeys.kemPub, JSON.stringify(payload));
    const plain = await unsealFromRecipient(ownerSession, sealed);
    const decoded = JSON.parse(plain);

    expect(decoded.reqId).toBe('test-req-1');
    expect(decoded.kind).toBe('create-resource');
    expect(decoded.requester.edPub).toBe(requesterKeys.edPub);
  });

  it('owner cannot unseal a request sealed to a different recipient', async () => {
    const requesterKeys = generateDeviceKeys();
    const ownerKeys = generateDeviceKeys();
    const thirdPartyKeys = generateDeviceKeys();
    const requesterSession = await makeStubSession(requesterKeys);
    const ownerSession = await makeStubSession(ownerKeys);

    // Sealed to thirdParty, not to owner
    const sealed = await sealToRecipient(requesterSession, thirdPartyKeys.kemPub, 'secret');
    await expect(unsealFromRecipient(ownerSession, sealed)).rejects.toThrow();
  });

  it('entry.addedBy reflects the sealer\'s edPub — sender-authenticity check', async () => {
    const requesterKeys = generateDeviceKeys();
    const ownerKeys = generateDeviceKeys();
    const requesterSession = await makeStubSession(requesterKeys);

    const sealed = await sealToRecipient(requesterSession, ownerKeys.kemPub, 'hello');
    // The owner's scan would verify: sealed.entry.addedBy === req.requester.edPub
    expect(sealed.entry.addedBy).toBe(requesterKeys.edPub);
  });

  it('requester cannot spoof the sender identity — addedBy is the real sealer', async () => {
    const attacker = generateDeviceKeys();
    const victim = generateDeviceKeys();
    const ownerKeys = generateDeviceKeys();
    const attackerSession = await makeStubSession(attacker);

    // Attacker seals a request claiming to be the victim
    const fakeClaim = JSON.stringify({
      requester: { edPub: victim.edPub, kemPub: victim.kemPub, userId: 'victim-id' },
    });
    const sealed = await sealToRecipient(attackerSession, ownerKeys.kemPub, fakeClaim);

    // The owner check: sealed.entry.addedBy should be attacker's edPub, NOT victim's
    expect(sealed.entry.addedBy).toBe(attacker.edPub);
    expect(sealed.entry.addedBy).not.toBe(victim.edPub);
    // → owner's check `addedBy === req.requester.edPub` would fail and skip this element
  });
});

// ── Grant seal / unseal round-trip ────────────────────────────────────────────

describe('ResourceGrant seal / unseal round-trip', () => {
  it('requester can unseal a grant sealed by the owner', async () => {
    const ownerKeys = generateDeviceKeys();
    const requesterKeys = generateDeviceKeys();
    const ownerSession = await makeStubSession(ownerKeys);
    const requesterSession = await makeStubSession(requesterKeys);

    const grant = {
      v: 1 as const,
      kind: 'grant' as const,
      reqId: 'test-req-1',
      spaceId: 'sp-test',
      nodeId: 'obj-abc',
      bundle: JSON.stringify({ spaceId: 'sp-test', nodeId: 'obj-abc', nodeName: 'Bug report', cap: {} }),
    };

    const sealed = await sealToRecipient(ownerSession, requesterKeys.kemPub, JSON.stringify(grant));
    const plain = await unsealFromRecipient(requesterSession, sealed);
    const decoded = JSON.parse(plain);

    expect(decoded.kind).toBe('grant');
    expect(decoded.nodeId).toBe('obj-abc');
    expect(decoded.reqId).toBe('test-req-1');
  });
});
