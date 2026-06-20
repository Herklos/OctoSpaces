/**
 * Tests for SDK pairing helpers — specifically the backward-compatible
 * `StartPairingOptions` hook (prefix + onProvisioned) and the dual-accept
 * QR format in `completeDevicePairing`.
 */
import { describe, expect, it, vi } from 'vitest';

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

vi.mock('@drakkar.software/starfish-identities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/starfish-identities')>();
  return {
    ...actual,
    provisionDevice: vi.fn(async () => ({
      deviceKeys: { kemPub: 'kempub-device', edPub: 'edpub-device', edPriv: 'edpriv-device', kemPriv: 'kempriv-device' },
      bundle: { stub: 'bundle' },
    })),
    sealWithPassphrase: vi.fn(async (_pin: string, _data: Uint8Array) => ({ v: 1, ct: 'sealed' })),
    openWithPassphrase: vi.fn(async (_pin: string, _sealed: unknown) => {
      return new TextEncoder().encode(JSON.stringify({ keys: { kemPub: 'k', edPub: 'e', edPriv: 'ep', kemPriv: 'kp' }, bundle: { stub: 'b' } }));
    }),
    installPairingBundle: vi.fn(async () => ({
      credentials: {
        userId: 'ed:edpub-root',
        device: { kemPub: 'k', edPub: 'e', edPriv: 'ep', kemPriv: 'kp' },
        capCert: { stub: 'cap' },
      },
    })),
  };
});

vi.mock('../../src/core/config.js', () => ({
  getSyncBase: vi.fn(() => 'https://sync.test'),
  getSyncNamespace: vi.fn(() => ''),
}));

vi.mock('@drakkar.software/starfish-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@drakkar.software/starfish-client')>();
  return {
    ...actual,
    StarfishClient: vi.fn().mockImplementation(() => ({
      push: vi.fn(async () => ({})),
      pull: vi.fn(async () => ({ data: { v: 1, ct: 'sealed' }, hash: 'h1' })),
    })),
  };
});

// ── Import (after mocks) ──────────────────────────────────────────────────────

import { startDevicePairing, completeDevicePairing, PAIR_PREFIX } from '../../src/sync/pairing.js';
import type { Session } from '../../src/sync/identity.js';
import { provisionDevice } from '@drakkar.software/starfish-identities';

function makeSession(): Session {
  return {
    userId: 'ed:edpub-root',
    keys: { edPub: 'edpub-root', edPriv: 'edpriv-root', kemPub: 'kempub-root', kemPriv: 'kempriv-root' },
  } as unknown as Session;
}

// ── startDevicePairing ────────────────────────────────────────────────────────

describe('startDevicePairing', () => {
  it('returns a QR payload with the default PAIR_PREFIX', async () => {
    const qr = await startDevicePairing(makeSession(), '1234');
    expect(qr.startsWith(PAIR_PREFIX)).toBe(true);
  });

  it('uses opts.prefix instead of PAIR_PREFIX when provided', async () => {
    const qr = await startDevicePairing(makeSession(), '1234', { prefix: 'octochat-pair:' });
    expect(qr.startsWith('octochat-pair:')).toBe(true);
    expect(qr.startsWith(PAIR_PREFIX)).toBe(false);
  });

  it('calls opts.onProvisioned with new device keys + userId', async () => {
    const hook = vi.fn();
    await startDevicePairing(makeSession(), '1234', { onProvisioned: hook });
    expect(hook).toHaveBeenCalledOnce();
    expect(hook).toHaveBeenCalledWith({
      kemPub: 'kempub-device',
      edPub: 'edpub-device',
      userId: 'ed:edpub-root',
    });
  });

  it('calls onProvisioned BEFORE the push (so keyring grants happen before the blob is published)', async () => {
    const callOrder: string[] = [];
    const { StarfishClient: MockClient } = await import('@drakkar.software/starfish-client');
    (MockClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      push: vi.fn(async () => { callOrder.push('push'); return {}; }),
      pull: vi.fn(async () => ({ data: { v: 1, ct: 'sealed' }, hash: 'h1' })),
    }));
    await startDevicePairing(makeSession(), '1234', {
      onProvisioned: async () => { callOrder.push('onProvisioned'); },
    });
    expect(callOrder).toEqual(['onProvisioned', 'push']);
  });

  it('QR payload encodes root edPub after the nonce', async () => {
    const qr = await startDevicePairing(makeSession(), '1234');
    const body = qr.slice(qr.indexOf(':') + 1);
    const [_nonce, rootEdPub] = body.split('.');
    expect(rootEdPub).toBe('edpub-root');
  });

  it('backward-compatible: no opts still works', async () => {
    await expect(startDevicePairing(makeSession(), '1234')).resolves.toMatch(/-pair:/);
  });
});

// ── completeDevicePairing dual-accept ─────────────────────────────────────────

describe('completeDevicePairing', () => {
  it('accepts octochat-pair: prefix (legacy QR format)', async () => {
    const payload = `octochat-pair:abc123nonce.edpub-root`;
    await expect(completeDevicePairing(payload, '1234')).resolves.toBeDefined();
  });

  it('accepts octospaces-pair: prefix (SDK default)', async () => {
    const payload = `${PAIR_PREFIX}abc123nonce.edpub-root`;
    await expect(completeDevicePairing(payload, '1234')).resolves.toBeDefined();
  });

  it('provisionDevice is called to build the new device keypair', async () => {
    await startDevicePairing(makeSession(), '1234');
    expect(provisionDevice).toHaveBeenCalled();
  });
});
