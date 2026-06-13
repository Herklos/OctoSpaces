/**
 * Cross-language conformance for invite link encode/decode.
 * Shares tests/test-vectors/invite-links.json with the Python suite.
 */
import { describe, it, expect } from 'vitest';
import { encodeSpaceInviteLink, decodeSpaceInviteLink } from './members.js';
import { encodeNodeInviteLink, decodeNodeInviteLink } from './nodes.js';
import type { SpaceInviteLinkToken } from './members.js';
import type { NodeInviteLinkToken } from './nodes.js';
import vectors from '../../../../../tests/test-vectors/invite-links.json';

describe('space invite link (vectors)', () => {
  it('encode matches vector', () => {
    const token = vectors.spaceToken.token as SpaceInviteLinkToken;
    expect(encodeSpaceInviteLink(vectors.origin, token)).toBe(vectors.spaceToken.full_link);
  });

  it('decode matches vector', () => {
    const decoded = decodeSpaceInviteLink(vectors.spaceToken.encoded_fragment);
    expect(decoded).toEqual(vectors.spaceToken.decoded);
  });

  it('roundtrip', () => {
    const token = vectors.spaceToken.token as SpaceInviteLinkToken;
    const link = encodeSpaceInviteLink(vectors.origin, token);
    const fragment = link.split('#')[1]!;
    expect(decodeSpaceInviteLink(fragment)).toEqual(token);
  });
});

describe('node invite link (vectors)', () => {
  it('encode matches vector', () => {
    const token = vectors.nodeToken.token as NodeInviteLinkToken;
    expect(encodeNodeInviteLink(vectors.origin, token)).toBe(vectors.nodeToken.full_link);
  });

  it('decode matches vector', () => {
    const decoded = decodeNodeInviteLink(vectors.nodeToken.encoded_fragment);
    expect(decoded).toEqual(vectors.nodeToken.decoded);
  });

  it('roundtrip', () => {
    const token = vectors.nodeToken.token as NodeInviteLinkToken;
    const link = encodeNodeInviteLink(vectors.origin, token);
    const fragment = link.split('#')[1]!;
    expect(decodeNodeInviteLink(fragment)).toEqual(token);
  });
});
