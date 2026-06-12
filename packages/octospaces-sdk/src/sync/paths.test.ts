import { describe, it, expect } from 'vitest';
import {
  OBJECT_COLLECTIONS,
  ownerScope,
  spaceMemberScope,
  nodeMemberScope,
  accountScope,
  linkedDeviceScope,
  nodeKeyringPull,
  nodeKeyringPush,
  objIndexPull,
  objIndexPush,
  objPubPull,
  objPubPush,
  objInvPull,
  objInvPush,
  objectDirPull,
  spacesPull,
  spacesPush,
  profilePull,
} from './paths.js';

describe('OBJECT_COLLECTIONS', () => {
  it('contains nodekeyring (per-node keyrings)', () => {
    expect(OBJECT_COLLECTIONS).toContain('nodekeyring');
  });

  it('contains the generic object storage collections', () => {
    expect(OBJECT_COLLECTIONS).toContain('objindex');
    expect(OBJECT_COLLECTIONS).toContain('objlog');
    expect(OBJECT_COLLECTIONS).toContain('objdoc');
    expect(OBJECT_COLLECTIONS).toContain('objblob');
    expect(OBJECT_COLLECTIONS).toContain('typeindex');
    expect(OBJECT_COLLECTIONS).toContain('objpub');
  });

  it('does NOT contain spacekeyring (removed — keyrings are now per-node)', () => {
    expect(OBJECT_COLLECTIONS).not.toContain('spacekeyring');
  });

  it('does NOT contain objinv (invite-only content excluded from broad scope)', () => {
    expect(OBJECT_COLLECTIONS).not.toContain('objinv');
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

  it('includes read, list, write ops', () => {
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

  it('does NOT include objinv in collections', () => {
    const scope = spaceMemberScope('sp-abc', true);
    expect(scope.collections).not.toContain('objinv');
  });
});

describe('nodeMemberScope', () => {
  it('scopes to the specific nodeId path', () => {
    const scope = nodeMemberScope('sp-1', 'n-42', true);
    expect(scope.paths).toEqual(
      expect.arrayContaining([expect.stringContaining('n-42')]),
    );
    expect(scope.paths).toEqual(
      expect.arrayContaining([expect.stringContaining('sp-1')]),
    );
  });

  it('includes objinv (invite-plaintext content gate)', () => {
    const scope = nodeMemberScope('sp-1', 'n-42', true);
    expect(scope.collections).toContain('objinv');
  });

  it('includes nodekeyring (node keyring access)', () => {
    const scope = nodeMemberScope('sp-1', 'n-42', true);
    expect(scope.collections).toContain('nodekeyring');
  });

  it('does NOT include broad space collections', () => {
    const scope = nodeMemberScope('sp-1', 'n-42', true);
    expect(scope.collections).not.toContain('objdoc');
    expect(scope.collections).not.toContain('objpub');
  });

  it('write=false omits write ops', () => {
    const scope = nodeMemberScope('sp-1', 'n-42', false);
    expect(scope.ops).not.toContain('write');
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
  it('contains nodekeyring (per-node keyrings)', () => {
    const scope = linkedDeviceScope('user-1');
    expect(scope.collections).toContain('nodekeyring');
  });

  it('contains standard account collections', () => {
    const scope = linkedDeviceScope('user-1');
    expect(scope.collections).toEqual(expect.arrayContaining(['profile', 'spaces']));
  });

  it('does NOT contain spacekeyring (removed)', () => {
    const scope = linkedDeviceScope('user-1');
    expect(scope.collections).not.toContain('spacekeyring');
  });

  it('does NOT contain pubspace', () => {
    const scope = linkedDeviceScope('user-1');
    expect(scope.collections).not.toContain('pubspace');
  });
});

describe('objectDirPull', () => {
  it('returns a pull path for the public shard', () => {
    expect(objectDirPull('public')).toContain('public');
    expect(objectDirPull('public')).toContain('_index/objects');
  });

  it('defaults to the public shard', () => {
    expect(objectDirPull()).toContain('public');
  });
});

describe('per-node keyring path helpers', () => {
  it('nodeKeyringPull / nodeKeyringPush embed spaceId and nodeId', () => {
    expect(nodeKeyringPull('sp-1', 'n-99')).toContain('sp-1');
    expect(nodeKeyringPull('sp-1', 'n-99')).toContain('n-99');
    expect(nodeKeyringPull('sp-1', 'n-99')).toContain('_keyring');
    expect(nodeKeyringPush('sp-1', 'n-99')).toContain('sp-1');
    expect(nodeKeyringPush('sp-1', 'n-99')).toContain('n-99');
  });

  it('nodeKeyringPull and nodeKeyringPush are symmetric (same subpath)', () => {
    const pull = nodeKeyringPull('sp-1', 'n-1').replace('/pull/', '/');
    const push = nodeKeyringPush('sp-1', 'n-1').replace('/push/', '/');
    expect(pull).toBe(push);
  });
});

describe('public node content path helpers', () => {
  it('objPubPull / objPubPush embed spaceId and nodeId', () => {
    expect(objPubPull('sp-1', 'n-5')).toContain('sp-1');
    expect(objPubPull('sp-1', 'n-5')).toContain('n-5');
    expect(objPubPush('sp-1', 'n-5')).toContain('pub');
  });
});

describe('invite-only content path helpers', () => {
  it('objInvPull / objInvPush embed spaceId and nodeId', () => {
    expect(objInvPull('sp-1', 'n-5')).toContain('sp-1');
    expect(objInvPull('sp-1', 'n-5')).toContain('n-5');
    expect(objInvPush('sp-1', 'n-5')).toContain('content');
  });
});

describe('object index path helpers', () => {
  it('objIndexPull / objIndexPush embed spaceId', () => {
    expect(objIndexPull('sp-1')).toContain('sp-1');
    expect(objIndexPush('sp-1')).toContain('sp-1');
  });
});

describe('other path helpers', () => {
  it('spacesPull / spacesPush use the userId', () => {
    expect(spacesPull('alice')).toContain('alice');
    expect(spacesPush('alice')).toContain('alice');
  });

  it('profilePull uses the userId', () => {
    expect(profilePull('alice')).toContain('alice');
  });
});
