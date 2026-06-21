/**
 * Real-crypto regression test for Fix C: link-joined members can decrypt E2EE nodes.
 *
 * No mocks on the keyring or identity layer — this exercises the actual
 * @drakkar.software/starfish-keyring and starfish-identities primitives so that if
 * the ephemeral KEM keypair is ever dropped or swapped again, this test fails loudly.
 *
 * What this proves:
 *   1. createKeyring puts ek.kemPub in the keyring (the minting side — same as
 *      addCollectionRecipient adds it in createSpaceInviteLink).
 *   2. createKeyringEncryptor with { kemPubHex: ek.kemPub, kemPrivHex: ek.kemPriv }
 *      SUCCEEDS — the ephemeral keypair can open the keyring (the decryption side).
 *   3. createKeyringEncryptor with the joiner's own device keypair (NOT a recipient)
 *      FAILS — confirming that session.keys alone is insufficient (the original bug).
 *
 * This directly mirrors the sequence in createSpaceInviteLink (step 2: ek.kemPub is
 * the keyring recipient) and in decryptKeysFor / openEncryptor (step 3: use
 * { kemPubHex: ek.kemPub, kemPrivHex: ek.kemPriv } to open it).
 *
 * We use createKeyring with multiple initial recipients (owner + ephemeral) rather than
 * the low-level addRecipient (which needs the raw CEK, an internal detail) because the
 * critical invariant being tested is on the READ side: can the ephemeral KEM decrypt?
 */
import { describe, it, expect } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { createKeyring, createKeyringEncryptor } from '@drakkar.software/starfish-keyring';

describe('Fix C — real-crypto: ephemeral KEM keypair decrypts; joiner own keypair does not', () => {
  it('ephemeral keypair (carried in the link token) opens the keyring', async () => {
    // The space owner's keypair
    const ownerKeys = generateDeviceKeys();
    // The ephemeral keypair minted by createSpaceInviteLink and embedded in the token
    const ek = generateDeviceKeys();

    // Owner creates the keyring with both the owner's KEM and the ephemeral KEM as recipients
    // (equivalent to createSpaceInviteLink calling ownerEnsureKeyring + addCollectionRecipient)
    const { keyring } = await createKeyring(
      { edPrivHex: ownerKeys.edPriv, edPubHex: ownerKeys.edPub },
      [{ subKemHex: ownerKeys.kemPub }, { subKemHex: ek.kemPub }],
    );

    // The joiner uses the ephemeral KEM from the link token to open the keyring
    const encryptor = await createKeyringEncryptor(
      keyring,
      { kemPubHex: ek.kemPub, kemPrivHex: ek.kemPriv },
      { trustedAdders: [ownerKeys.edPub] },
    );

    expect(encryptor).toBeDefined();
    // createKeyringEncryptor returns { encrypt, decrypt, sealBytes, openBytes }
    expect(typeof (encryptor as { encrypt?: unknown }).encrypt).toBe('function');
  });

  it("joiner's own device keypair (NOT in the keyring) fails to open the keyring", async () => {
    // The space owner's keypair
    const ownerKeys = generateDeviceKeys();
    // The ephemeral keypair that IS in the keyring
    const ek = generateDeviceKeys();
    // The joiner's own device keypair — the bug was using this for decryption
    const joinerKeys = generateDeviceKeys();

    const { keyring } = await createKeyring(
      { edPrivHex: ownerKeys.edPriv, edPubHex: ownerKeys.edPub },
      [{ subKemHex: ownerKeys.kemPub }, { subKemHex: ek.kemPub }],
    );

    // Joiner's own keypair is NOT in the keyring — this MUST fail (same error as pre-Fix-C)
    await expect(
      createKeyringEncryptor(
        keyring,
        { kemPubHex: joinerKeys.kemPub, kemPrivHex: joinerKeys.kemPriv },
        { trustedAdders: [ownerKeys.edPub] },
      ),
    ).rejects.toThrow();
  });

  it('sealBytes+openBytes round-trip: ephemeral key encrypts, ephemeral key decrypts', async () => {
    const ownerKeys = generateDeviceKeys();
    const ek = generateDeviceKeys();

    const { keyring } = await createKeyring(
      { edPrivHex: ownerKeys.edPriv, edPubHex: ownerKeys.edPub },
      [{ subKemHex: ownerKeys.kemPub }, { subKemHex: ek.kemPub }],
    );

    const enc = await createKeyringEncryptor(
      keyring,
      { kemPubHex: ek.kemPub, kemPrivHex: ek.kemPriv },
      { trustedAdders: [ownerKeys.edPub] },
    );

    const plaintext = new TextEncoder().encode('hello e2e fix c');
    // createKeyringEncryptor returns { sealBytes, openBytes, encrypt, decrypt }
    const ciphertext = await (enc as { sealBytes: (p: Uint8Array) => Promise<Uint8Array> }).sealBytes(plaintext);
    const decrypted = await (enc as { openBytes: (c: Uint8Array) => Promise<Uint8Array> }).openBytes(ciphertext);
    expect(decrypted).toEqual(plaintext);
  });

  it('owner keypair also decrypts (sanity check — owner is always a recipient)', async () => {
    const ownerKeys = generateDeviceKeys();
    const ek = generateDeviceKeys();

    const { keyring } = await createKeyring(
      { edPrivHex: ownerKeys.edPriv, edPubHex: ownerKeys.edPub },
      [{ subKemHex: ownerKeys.kemPub }, { subKemHex: ek.kemPub }],
    );

    const ownerEnc = await createKeyringEncryptor(
      keyring,
      { kemPubHex: ownerKeys.kemPub, kemPrivHex: ownerKeys.kemPriv },
      { trustedAdders: [ownerKeys.edPub] },
    );
    expect(typeof (ownerEnc as { encrypt?: unknown }).encrypt).toBe('function');
  });
});
