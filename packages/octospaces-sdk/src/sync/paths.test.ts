import { describe, it, expect } from 'vitest';
import {
  OBJECT_COLLECTIONS,
  ownerScope,
  spaceMemberScope,
  accountScope,
  linkedDeviceScope,
  keyringPull,
  keyringPush,
  objIndexPull,
  objIndexPush,
  spacesPull,
  spacesPush,
  profilePull,
  spaceIndexPull,
} from './paths.js';

describe('OBJECT_COLLECTIONS', () => {
  it('contains the canonical generic object collections', () => {
    expect(OBJECT_COLLECTIONS).toContain('spacekeyring');
    expect(OBJECT_COLLECTIONS).toContain('objindex');
    expect(OBJECT_COLLECTIONS).toContain('objlog');
    expect(OBJECT_COLLECTIONS).toContain('objdoc');
    expect(OBJECT_COLLECTIONS).toContain('objblob');
    expect(OBJECT_COLLECTIONS).toContain('typeindex');
  });

  it('does NOT contain chat-only collections', () => {
    expect(OBJECT_COLLECTIONS).not.toContain('chat');
    expect(OBJECT_COLLECTIONS).not.toContain('dminbox');
  });
});

describe('ownerScope', () => {
  it('uses OBJECT_COLLECTIONS', () => {
    const scope = ownerScope();
    expect(scope.collections).toEqual(OBJECT_COLLECTIONS);
  });

  it('includes wildcard ops', () => {
    const scope = ownerScope();
    expect(scope.ops).toContain('read');
    expect(scope.ops).toContain('write');
  });
});

describe('spaceMemberScope', () => {
  it('scopes to the given spaceId path', () => {
    const scope = spaceMemberScope('sp-abc', true);
    expect(scope.paths).toEqual(expect.arrayContaining([expect.stringContaining('sp-abc')]));
  });

  it('write=true grants write ops', () => {
    const scope = spaceMemberScope('sp-abc', true);
    expect(scope.ops).toContain('write');
  });

  it('write=false omits write ops', () => {
    const scope = spaceMemberScope('sp-abc', false);
    expect(scope.ops).not.toContain('write');
  });

  it('collections equal OBJECT_COLLECTIONS', () => {
    const scope = spaceMemberScope('sp-abc', true);
    expect(scope.collections).toEqual(OBJECT_COLLECTIONS);
  });
});

describe('accountScope', () => {
  it('does NOT contain dminbox', () => {
    const scope = accountScope('user-1');
    expect(scope.collections).not.toContain('dminbox');
  });

  it('does NOT contain pubspace', () => {
    const scope = accountScope('user-1');
    expect(scope.collections).not.toContain('pubspace');
  });

  it('does NOT include pubspaces/ paths', () => {
    const scope = accountScope('user-1');
    const hasPubspaces = (scope.paths ?? []).some((p) => p.includes('pubspaces/'));
    expect(hasPubspaces).toBe(false);
  });

  it('scopes to the given userId', () => {
    const scope = accountScope('user-1');
    expect(scope.paths).toEqual(expect.arrayContaining([expect.stringContaining('user-1')]));
  });
});

describe('linkedDeviceScope', () => {
  it('contains both object and account collections', () => {
    const scope = linkedDeviceScope('user-1');
    expect(scope.collections).toEqual(expect.arrayContaining(['spacekeyring', 'profile', 'spaces']));
  });

  it('does NOT contain pubspace', () => {
    const scope = linkedDeviceScope('user-1');
    expect(scope.collections).not.toContain('pubspace');
  });

  it('does NOT include pubspaces/ paths', () => {
    const scope = linkedDeviceScope('user-1');
    const hasPubspaces = (scope.paths ?? []).some((p) => p.includes('pubspaces/'));
    expect(hasPubspaces).toBe(false);
  });
});

describe('spaceIndexPull', () => {
  it('returns a pull path for the public shard', () => {
    expect(spaceIndexPull('public')).toContain('public');
  });
});

describe('path helpers', () => {
  it('keyringPull / keyringPush are symmetric', () => {
    expect(keyringPull('sp-1')).toContain('sp-1');
    expect(keyringPush('sp-1')).toContain('sp-1');
  });

  it('objIndexPull / objIndexPush are symmetric', () => {
    expect(objIndexPull('sp-1')).toContain('sp-1');
    expect(objIndexPush('sp-1')).toContain('sp-1');
  });

  it('spacesPull / spacesPush use the userId', () => {
    expect(spacesPull('alice')).toContain('alice');
    expect(spacesPush('alice')).toContain('alice');
  });

  it('profilePull uses the userId', () => {
    expect(profilePull('alice')).toContain('alice');
  });
});
