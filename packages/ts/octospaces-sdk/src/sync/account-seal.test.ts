import { describe, it, expect, beforeAll } from 'vitest';
import { sealToRecipient, unsealFromRecipient, sealToSelf, unsealFromSelf } from './account-seal.js';
import type { SealedBlob } from './account-seal.js';

// Minimal stubs — use WebCrypto + @noble/curves which are already deps.
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

function makeKeyPair() {
  const edPrivBytes = randomBytes(32);
  const edPriv = toHex(edPrivBytes);
  const edPub = toHex(ed25519.getPublicKey(edPrivBytes));
  const kemPrivBytes = randomBytes(32);
  const kemPriv = toHex(kemPrivBytes);
  const kemPub = toHex(x25519.getPublicKey(kemPrivBytes));
  return { edPriv, edPub, kemPriv, kemPub };
}

function makeSession(keys: ReturnType<typeof makeKeyPair>) {
  return { userId: 'test-user', keys } as Parameters<typeof sealToSelf>[0];
}

describe('account-seal', () => {
  it('sealToSelf returns a SealedBlob with entry and ct', async () => {
    const keys = makeKeyPair();
    const session = makeSession(keys);
    const sealed: SealedBlob = await sealToSelf(session, 'hello');
    expect(sealed).toHaveProperty('entry');
    expect(sealed).toHaveProperty('ct');
    expect(typeof sealed.ct).toBe('string');
  });

  it('sealToSelf / unsealFromSelf round-trips a string payload', async () => {
    const keys = makeKeyPair();
    const session = makeSession(keys);
    const payload = JSON.stringify({ test: true, value: 42 });
    const sealed = await sealToSelf(session, payload);
    const recovered = await unsealFromSelf(session, sealed);
    expect(recovered).toBe(payload);
  });

  it('sealToRecipient returns a SealedBlob', async () => {
    const sender = makeKeyPair();
    const senderSession = makeSession(sender);
    const recipient = makeKeyPair();
    const sealed = await sealToRecipient(senderSession, recipient.kemPub, 'secret');
    expect(sealed).toHaveProperty('entry');
    expect(sealed).toHaveProperty('ct');
  });

  it('unsealFromRecipient decrypts what sealToRecipient sealed', async () => {
    const sender = makeKeyPair();
    const senderSession = makeSession(sender);
    const recipient = makeKeyPair();
    const recipientSession = makeSession(recipient);
    const message = 'hello from sender';
    const sealed = await sealToRecipient(senderSession, recipient.kemPub, message);
    const decrypted = await unsealFromRecipient(recipientSession, sealed);
    expect(decrypted).toBe(message);
  });
});

// ── v:1 blobs MUST be opened with the matching aad ───────────────────────────
//
// open() must assert aad when blob.v === 1. A caller that drops aad silently
// decrypts an unbound (context-free) blob — enabling relocation/replay attacks.
//
// Fix: if blob.v === 1, aad is mandatory; omitting it must throw before any
// AES-GCM operation, even if the ciphertext would otherwise decrypt.

describe('v:1 blob requires aad on open', () => {
  let keys: ReturnType<typeof makeKeyPair>;
  let session: ReturnType<typeof makeSession>;

  beforeAll(() => {
    keys = makeKeyPair();
    session = makeSession(keys);
  });

  it('sealToSelf with aad produces blob.v === 1', async () => {
    const blob = await sealToSelf(session, 'payload', 'context-aad');
    expect(blob.v).toBe(1);
  });

  it('sealToSelf without aad produces blob without v', async () => {
    const blob = await sealToSelf(session, 'payload');
    expect(blob.v).toBeUndefined();
  });

  it('FAILS (pre-fix): unsealFromSelf with v:1 blob and NO aad must throw (downgrade rejected)', async () => {
    const blob = await sealToSelf(session, 'payload', 'my-context');
    // blob.v === 1 but we omit aad — must be rejected without attempting decrypt
    await expect(unsealFromSelf(session, blob /* no aad */)).rejects.toThrow(
      /aad.*required|missing.*aad|v:1.*requires|context.*required/i,
    );
  });

  it('unsealFromSelf with v:1 blob and CORRECT aad succeeds', async () => {
    const blob = await sealToSelf(session, 'my-payload', 'my-context');
    const result = await unsealFromSelf(session, blob, 'my-context');
    expect(result).toBe('my-payload');
  });

  it('unsealFromSelf with v:1 blob and WRONG aad fails (AES-GCM auth tag)', async () => {
    const blob = await sealToSelf(session, 'my-payload', 'correct-context');
    await expect(unsealFromSelf(session, blob, 'wrong-context')).rejects.toThrow();
  });

  it('FAILS (pre-fix): unsealFromRecipient with v:1 blob and NO aad must throw', async () => {
    const sender = makeKeyPair();
    const senderSession = makeSession(sender);
    const recipient = makeKeyPair();
    const recipientSession = makeSession(recipient);
    const blob = await sealToRecipient(senderSession, recipient.kemPub, 'payload', 'inbox-aad');
    await expect(unsealFromRecipient(recipientSession, blob /* no aad */)).rejects.toThrow(
      /aad.*required|missing.*aad|v:1.*requires|context.*required/i,
    );
  });

  it('unsealFromRecipient with v:1 blob and CORRECT aad succeeds', async () => {
    const sender = makeKeyPair();
    const senderSession = makeSession(sender);
    const recipient = makeKeyPair();
    const recipientSession = makeSession(recipient);
    const blob = await sealToRecipient(senderSession, recipient.kemPub, 'payload', 'inbox-aad');
    const result = await unsealFromRecipient(recipientSession, blob, 'inbox-aad');
    expect(result).toBe('payload');
  });

  it('legacy blob (no v field) can be opened without aad (backward compat)', async () => {
    // Legacy blobs sealed without aad must still be decryptable — no v means no enforcement.
    const blob = await sealToSelf(session, 'legacy-payload');
    expect(blob.v).toBeUndefined();
    const result = await unsealFromSelf(session, blob);
    expect(result).toBe('legacy-payload');
  });
});
