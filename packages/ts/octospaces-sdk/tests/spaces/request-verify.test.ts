/**
 * Unit tests for the shared kemSig verification used by inviteToSpace /
 * inviteToNode / scanResourceRequests. kemSig binds kemPub to the edPub identity
 * (Ed25519 sig of kemPub bytes by edPriv); a failure here is a security hole, so
 * the predicate is pinned independently of the invite flows that consume it.
 */
import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@drakkar.software/starfish-keyring';
import { verifyKemSig } from '../../src/spaces/request-verify.js';

function identity() {
  const edPriv = ed25519.utils.randomSecretKey();
  const edPub = ed25519.getPublicKey(edPriv);
  // kemPub is an opaque 32-byte value here; the signature is over its bytes.
  const kemPub = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
  const kemSig = ed25519.sign(kemPub, edPriv);
  return {
    edPub: bytesToHex(edPub),
    kemPub: bytesToHex(kemPub),
    kemSig: bytesToHex(kemSig),
    edPriv: bytesToHex(edPriv),
  };
}

describe('verifyKemSig', () => {
  it('accepts a valid kemSig (kemPub signed by the edPriv behind edPub)', () => {
    const { edPub, kemPub, kemSig } = identity();
    expect(verifyKemSig(edPub, kemPub, kemSig)).toBe(true);
  });

  it('rejects a missing/empty kemSig', () => {
    const { edPub, kemPub } = identity();
    expect(verifyKemSig(edPub, kemPub, undefined)).toBe(false);
    expect(verifyKemSig(edPub, kemPub, '')).toBe(false);
  });

  it('rejects a kemSig made by a different identity', () => {
    const a = identity();
    const b = identity();
    // b's signature over b.kemPub does not verify against a's edPub.
    expect(verifyKemSig(a.edPub, b.kemPub, b.kemSig)).toBe(false);
  });

  it('rejects a substituted kemPub (MITM) under a valid signature', () => {
    const { edPub, kemSig } = identity();
    const other = identity();
    expect(verifyKemSig(edPub, other.kemPub, kemSig)).toBe(false);
  });

  it('rejects malformed hex without throwing', () => {
    const { edPub, kemPub, kemSig } = identity();
    expect(verifyKemSig('zz', kemPub, kemSig)).toBe(false);
    expect(verifyKemSig(edPub, 'not-hex', kemSig)).toBe(false);
    expect(verifyKemSig(edPub, kemPub, 'xyz')).toBe(false);
  });
});
