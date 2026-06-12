import { describe, it, expect } from 'vitest';
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
