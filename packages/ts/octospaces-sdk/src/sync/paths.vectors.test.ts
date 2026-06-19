/**
 * Cross-language conformance for sync/paths.ts, core/ids.ts, sync/base64url.ts.
 * Shares vectors with the Python suite.
 */
import { describe, it, expect } from 'vitest';
import {
  OBJECT_COLLECTIONS,
  ownerScope,
  spaceMemberScope,
  nodeMemberScope,
  accountScope,
  linkedDeviceScope,
  keyringPull,
  keyringPush,
  objIndexPull,
  objIndexPush,
  profilePull,
  profilePush,
  spacesPull,
  spacesPush,
  spaceAccessPull,
  spaceAccessPush,
  userIdFromEdPub,
} from './paths.js';
import { roomSlug } from '../core/ids.js';
import { toBase64Url, fromBase64Url } from './base64.js';

import pathsVectors from '../../../../../tests/test-vectors/paths-scopes.json';
import userIdVectors from '../../../../../tests/test-vectors/user-id.json';
import slugVectors from '../../../../../tests/test-vectors/room-slug.json';
import b64Vectors from '../../../../../tests/test-vectors/base64url.json';

const fromBase64UrlJson = (s: string) => JSON.parse(fromBase64Url(s));

describe('userIdFromEdPub (vectors)', () => {
  for (const c of userIdVectors.vectors) {
    it(`edPub ${c.edPub.slice(0, 8)}… → ${c.userId}`, async () => {
      const result = await userIdFromEdPub(c.edPub);
      expect(result).toBe(c.userId);
      expect(result.length).toBe(32);
    });
  }
});

describe('roomSlug (vectors)', () => {
  for (const c of slugVectors.vectors) {
    it(`roomSlug(${JSON.stringify(c.input)}) → ${JSON.stringify(c.expected)}`, () => {
      expect(roomSlug(c.input)).toBe(c.expected);
    });
  }
});

describe('path builders (vectors)', () => {
  const { paths, path_inputs: inp } = pathsVectors;
  it('keyringPull', () => expect(keyringPull(inp.spaceId)).toBe(paths.keyringPull));
  it('keyringPush', () => expect(keyringPush(inp.spaceId)).toBe(paths.keyringPush));
  it('objIndexPull', () => expect(objIndexPull(inp.spaceId)).toBe(paths.objIndexPull));
  it('objIndexPush', () => expect(objIndexPush(inp.spaceId)).toBe(paths.objIndexPush));
  it('profilePull', () => expect(profilePull(inp.userId)).toBe(paths.profilePull));
  it('profilePush', () => expect(profilePush(inp.userId)).toBe(paths.profilePush));
  it('spacesPull', () => expect(spacesPull(inp.userId)).toBe(paths.spacesPull));
  it('spacesPush', () => expect(spacesPush(inp.userId)).toBe(paths.spacesPush));
  it('spaceAccessPull', () => expect(spaceAccessPull(inp.spaceId)).toBe(paths.spaceAccessPull));
  it('spaceAccessPush', () => expect(spaceAccessPush(inp.spaceId)).toBe(paths.spaceAccessPush));
});

describe('cap scopes (vectors)', () => {
  const { scopes, path_inputs: inp } = pathsVectors;
  it('ownerScope', () => expect(ownerScope()).toEqual(scopes.owner));
  it('spaceMemberScope write', () => expect(spaceMemberScope(inp.spaceId, true)).toEqual(scopes.spaceMember_write));
  it('spaceMemberScope read', () => expect(spaceMemberScope(inp.spaceId, false)).toEqual(scopes.spaceMember_read));
  it('nodeMemberScope write', () => expect(nodeMemberScope(inp.spaceId, inp.nodeId, true)).toEqual(scopes.nodeMember_write));
  it('nodeMemberScope read', () => expect(nodeMemberScope(inp.spaceId, inp.nodeId, false)).toEqual(scopes.nodeMember_read));
  it('accountScope', () => expect(accountScope(inp.userId)).toEqual(scopes.account));
  it('linkedDeviceScope', () => expect(linkedDeviceScope(inp.userId)).toEqual(scopes.linkedDevice));
});

describe('OBJECT_COLLECTIONS (vectors)', () => {
  it('matches vector', () => {
    expect(OBJECT_COLLECTIONS).toEqual(pathsVectors.OBJECT_COLLECTIONS);
  });
});

describe('base64url (vectors)', () => {
  for (const c of b64Vectors.vectors) {
    it(`roundtrip for ${JSON.stringify(c.object).slice(0, 40)}`, () => {
      const encoded = toBase64Url(JSON.stringify(c.object));
      expect(encoded).toBe(c.encoded);
      expect(fromBase64UrlJson(encoded)).toEqual(c.roundtrip);
    });
  }
});
