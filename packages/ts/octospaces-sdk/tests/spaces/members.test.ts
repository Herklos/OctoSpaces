import { describe, it, expect } from 'vitest';
import {
  decodeSpaceInviteLink,
  encodeSpaceInviteLink,
  acceptSpaceInvite,
} from '../../src/spaces/members.js';
import { toBase64Url } from '../../src/sync/base64.js';
import type { SpaceInviteLinkToken } from '../../src/spaces/members.js';

const baseToken: SpaceInviteLinkToken = {
  v: 1,
  spaceId: 'sp-abc123',
  spaceName: 'My Space',
  cap: { kind: 'member', iss: 'deadbeef', sub: 'cafecafe', scope: {} },
  key: 'a1b2c3d4',
  kemPriv: 'eph-kempriv-hex',
  kemPub: 'eph-kempub-hex',
  write: true,
};

describe('encodeSpaceInviteLink / decodeSpaceInviteLink', () => {
  it('round-trips a token through encode → decode', () => {
    const link = encodeSpaceInviteLink('https://app.example.com', baseToken);
    expect(link).toContain('#');
    const decoded = decodeSpaceInviteLink(link.split('#')[1]!);
    expect(decoded.spaceId).toBe(baseToken.spaceId);
    expect(decoded.spaceName).toBe(baseToken.spaceName);
    expect(decoded.key).toBe(baseToken.key);
    expect(decoded.write).toBe(true);
    expect(decoded.v).toBe(1);
  });

  it('round-trip preserves kemPriv and kemPub (Fix C)', () => {
    const link = encodeSpaceInviteLink('https://app.example.com', baseToken);
    const decoded = decodeSpaceInviteLink(link.split('#')[1]!);
    expect(decoded.kemPriv).toBe('eph-kempriv-hex');
    expect(decoded.kemPub).toBe('eph-kempub-hex');
  });

  it('legacy token without kemPriv/kemPub decodes without throwing (back-compat)', () => {
    const legacyToken = { v: 1, spaceId: 'sp-old', spaceName: 'Old Space', cap: { kind: 'member' }, key: 'old-key', write: false };
    const encoded = toBase64Url(JSON.stringify(legacyToken));
    const decoded = decodeSpaceInviteLink(encoded);
    expect(decoded.spaceId).toBe('sp-old');
    expect(decoded.kemPriv).toBeUndefined();
    expect(decoded.kemPub).toBeUndefined();
  });

  it('decodeSpaceInviteLink accepts a # prefixed fragment', () => {
    const link = encodeSpaceInviteLink('https://app.example.com', baseToken);
    const fragment = '#' + link.split('#')[1]!;
    const decoded = decodeSpaceInviteLink(fragment);
    expect(decoded.spaceId).toBe(baseToken.spaceId);
  });

  it('write is false when token has write:false', () => {
    const noWrite: SpaceInviteLinkToken = { ...baseToken, write: false };
    const link = encodeSpaceInviteLink('https://app.example.com', noWrite);
    const decoded = decodeSpaceInviteLink(link.split('#')[1]!);
    expect(decoded.write).toBe(false);
  });

  it('strips trailing slash from origin', () => {
    const link = encodeSpaceInviteLink('https://app.example.com/', baseToken);
    expect(link.startsWith('https://app.example.com/join#')).toBe(true);
  });

  it('throws on malformed fragment', () => {
    expect(() => decodeSpaceInviteLink('not-base64url!!!')).toThrow();
  });

  it('throws when required fields are missing', () => {
    const bad = toBase64Url(JSON.stringify({ v: 1, spaceName: 'x' }));
    expect(() => decodeSpaceInviteLink(bad)).toThrow();
  });
});

describe('acceptSpaceInvite validation', () => {
  it('rejects invite with wrong cap.kind', async () => {
    const inv = JSON.stringify({ spaceId: 'sp-x', cap: { kind: 'device', sub: 'abc', iss: 'def' } });
    await expect(
      acceptSpaceInvite({ keys: { edPub: 'abc' }, accountClient: {} } as never, inv),
    ).rejects.toThrow('not a valid space invite');
  });

  it('rejects invite with mismatched sub', async () => {
    const inv = JSON.stringify({
      spaceId: 'sp-x',
      cap: { kind: 'member', sub: 'different-pub', iss: 'owner-pub' },
    });
    await expect(
      acceptSpaceInvite({ keys: { edPub: 'my-pub' }, accountClient: {} } as never, inv),
    ).rejects.toThrow('different identity');
  });

  it('accepts invite with no iss field (no longer required — keyrings are per-node now)', async () => {
    const inv = JSON.stringify({
      spaceId: 'sp-x',
      spaceName: 'My Space',
      cap: { kind: 'member', sub: 'my-pub' },
    });
    // Should NOT throw on missing iss — the iss check was removed with space keyrings.
    // The accountClient.push mock is needed for addJoinedSpaceWithCap.
    const fakeClient = {
      pull: () => Promise.resolve({ data: { v: 1, spaces: [], caps: {}, pubAccess: {} }, hash: null }),
      push: () => Promise.resolve(),
    };
    await expect(
      acceptSpaceInvite({ keys: { edPub: 'my-pub' }, accountClient: fakeClient, userId: 'alice' } as never, inv),
    ).resolves.toMatchObject({ id: 'sp-x' });
  });
});
