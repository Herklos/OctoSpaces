import { describe, it, expect } from 'vitest';
import { previewInvite } from '../../src/utils/invite-preview.js';
import { encodeSpaceInviteLink } from '../../src/spaces/members.js';
import { encodeNodeInviteLink } from '../../src/spaces/nodes.js';
import type { SpaceInviteLinkToken } from '../../src/spaces/members.js';
import type { NodeInviteLinkToken } from '../../src/spaces/nodes.js';

const spaceToken: SpaceInviteLinkToken = {
  v: 1,
  spaceId: 'sp-abc123',
  spaceName: 'My Space',
  cap: { kind: 'member', iss: 'deadbeef', sub: 'cafecafe', scope: {} },
  key: 'a1b2c3d4',
  write: true,
};

const nodeToken: NodeInviteLinkToken = {
  v: 1,
  spaceId: 'sp-abc123',
  nodeId: 'nd-xyz789',
  nodeName: 'Secret Doc',
  cap: { kind: 'member', iss: 'deadbeef', sub: 'cafecafe', scope: {} },
  key: 'b2c3d4e5',
  write: false,
};

const spaceLink = encodeSpaceInviteLink('https://app.example.com', spaceToken);
const nodeLink = encodeNodeInviteLink('https://app.example.com', nodeToken);

// ── space-link ────────────────────────────────────────────────────────────────

describe('previewInvite — space-link', () => {
  it('classifies a space invite link', () => {
    const p = previewInvite(spaceLink);
    expect(p.kind).toBe('space-link');
  });

  it('extracts spaceName and write flag', () => {
    const p = previewInvite(spaceLink);
    if (p.kind !== 'space-link') throw new Error('wrong kind');
    expect(p.spaceName).toBe('My Space');
    expect(p.write).toBe(true);
  });

  it('exposes the decoded token', () => {
    const p = previewInvite(spaceLink);
    if (p.kind !== 'space-link') throw new Error('wrong kind');
    expect(p.token.spaceId).toBe('sp-abc123');
  });

  it('accepts a raw fragment (no origin prefix)', () => {
    const fragment = spaceLink.slice(spaceLink.indexOf('#'));
    const p = previewInvite(fragment);
    expect(p.kind).toBe('space-link');
  });

  it('accepts a read-only (write:false) link', () => {
    const readOnlyToken: SpaceInviteLinkToken = { ...spaceToken, write: false };
    const link = encodeSpaceInviteLink('https://app.example.com', readOnlyToken);
    const p = previewInvite(link);
    if (p.kind !== 'space-link') throw new Error('wrong kind');
    expect(p.write).toBe(false);
  });
});

// ── node-link ─────────────────────────────────────────────────────────────────

describe('previewInvite — node-link', () => {
  it('classifies a node invite link', () => {
    const p = previewInvite(nodeLink);
    expect(p.kind).toBe('node-link');
  });

  it('extracts nodeTitle from nodeName', () => {
    const p = previewInvite(nodeLink);
    if (p.kind !== 'node-link') throw new Error('wrong kind');
    expect(p.nodeTitle).toBe('Secret Doc');
  });

  it('exposes spaceId via spaceName fallback', () => {
    const p = previewInvite(nodeLink);
    if (p.kind !== 'node-link') throw new Error('wrong kind');
    expect(p.spaceName).toContain('abc123'.slice(-6));
  });

  it('exposes the decoded token', () => {
    const p = previewInvite(nodeLink);
    if (p.kind !== 'node-link') throw new Error('wrong kind');
    expect(p.token.nodeId).toBe('nd-xyz789');
  });
});

// ── member-bundle ─────────────────────────────────────────────────────────────

const bundle = JSON.stringify({
  spaceId: 'sp-abc123',
  spaceName: 'Team Space',
  cap: { kind: 'member', iss: 'aabbccddee112233' },
});

describe('previewInvite — member-bundle', () => {
  it('classifies a private member-bundle JSON', () => {
    const p = previewInvite(bundle);
    expect(p.kind).toBe('member-bundle');
  });

  it('extracts spaceName and spaceId', () => {
    const p = previewInvite(bundle);
    if (p.kind !== 'member-bundle') throw new Error('wrong kind');
    expect(p.spaceName).toBe('Team Space');
    expect(p.spaceId).toBe('sp-abc123');
  });

  it('builds issuerKey fingerprint from iss', () => {
    const p = previewInvite(bundle);
    if (p.kind !== 'member-bundle') throw new Error('wrong kind');
    expect(p.issuerKey).toContain('aabbccdd');
    expect(p.issuerKey).toContain('…');
  });

  it('issuerKey is null when iss is absent', () => {
    const noIss = JSON.stringify({ spaceId: 'sp-abc123', cap: { kind: 'member' } });
    const p = previewInvite(noIss);
    if (p.kind !== 'member-bundle') throw new Error('wrong kind');
    expect(p.issuerKey).toBeNull();
  });

  it('falls back to id-derived spaceName when spaceName is absent', () => {
    const noName = JSON.stringify({ spaceId: 'sp-abc123', cap: { kind: 'member' } });
    const p = previewInvite(noName);
    if (p.kind !== 'member-bundle') throw new Error('wrong kind');
    expect(p.spaceName).toBe('space-abc123');
  });

  it('preserves raw inviteJson verbatim', () => {
    const p = previewInvite(bundle);
    if (p.kind !== 'member-bundle') throw new Error('wrong kind');
    expect(p.inviteJson).toBe(bundle);
  });
});

// ── error cases ───────────────────────────────────────────────────────────────

describe('previewInvite — errors', () => {
  it('throws on empty input', () => {
    expect(() => previewInvite('')).toThrow('Paste an invite');
  });

  it('throws on a whitespace-only input', () => {
    expect(() => previewInvite('   ')).toThrow('Paste an invite');
  });

  it('throws on a malformed URL fragment', () => {
    expect(() => previewInvite('#not-valid-base64!!!!')).toThrow();
  });

  it('throws on plain text (not JSON, not a link)', () => {
    expect(() => previewInvite('hello world')).toThrow("doesn't look like an invite");
  });

  it('throws on JSON that is not a member bundle', () => {
    expect(() => previewInvite(JSON.stringify({ foo: 'bar' }))).toThrow('not a valid space invite');
  });

  it('throws on a bundle whose cap.kind is not member', () => {
    const bad = JSON.stringify({ spaceId: 'sp-1', cap: { kind: 'owner' } });
    expect(() => previewInvite(bad)).toThrow('not a valid space invite');
  });
});
