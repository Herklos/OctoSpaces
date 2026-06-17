/**
 * Regression tests for resource-requests.ts — H1, M2, L1.
 *
 * H1: acceptResourceRequest must call inviteToNode with opts.isolated === true,
 *     and must NOT call addSpaceMember directly.
 * M2: scanResourceRequests rejects inbox items where req.requester.userId
 *     does not match userIdFromEdPub(req.requester.edPub).
 * L1: scanResourceGrants deduplicates by reqId.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { bytesToHex, hexToBytes } from '@drakkar.software/starfish-keyring';
import { ed25519 } from '@noble/curves/ed25519.js';

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock('../sync/inbox.js', () => ({
  inboxShard: vi.fn(() => '2024-06'),
  inboxShards: vi.fn(() => ['2024-06', '2024-05']),
  pullInbox: vi.fn(),
}));

vi.mock('../sync/account-seal.js', () => ({
  sealToRecipient: vi.fn(),
  unsealFromRecipient: vi.fn(),
  sealToSelf: vi.fn(),
  unsealFromSelf: vi.fn(),
}));

vi.mock('./object-index.js', () => ({
  readObjectTree: vi.fn(),
  updateObjectIndex: vi.fn(),
  seedSpaceObjectIndex: vi.fn(),
}));

vi.mock('./nodes.js', () => ({
  createNode: vi.fn(),
  inviteToNode: vi.fn(),
  acceptNodeInvite: vi.fn(),
}));

vi.mock('./registry.js', () => ({
  addSpaceMember: vi.fn(),
  readSpaces: vi.fn(),
}));

vi.mock('../sync/signed-append.js', () => ({
  appendToInbox: vi.fn(),
  postAnonymousAppend: vi.fn(),
}));

vi.mock('./identity-link.js', () => ({
  verifyIdentityLinkBinding: vi.fn(() => Promise.resolve(true)),
  verifyIdentityLinkKeys: vi.fn(() => Promise.resolve()),
  encodeIdentityLink: vi.fn(),
  decodeIdentityLink: vi.fn(),
  myIdentityLink: vi.fn(),
}));

vi.mock('../core/config.js', () => ({
  getSyncBase: vi.fn(() => 'http://localhost:8787'),
  getSyncNamespace: vi.fn(() => undefined),
  getSyncPrefix: vi.fn(() => ''),
  getOnServerReachable: vi.fn(() => undefined),
  getWebBase: vi.fn(() => ''),
}));

vi.mock('../sync/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sync/paths.js')>();
  return {
    ...original,
    userIdFromEdPub: vi.fn(),
  };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { pullInbox } from '../sync/inbox.js';
import { unsealFromRecipient, sealToRecipient } from '../sync/account-seal.js';
import { readObjectTree } from './object-index.js';
import { createNode, inviteToNode } from './nodes.js';
import { addSpaceMember } from './registry.js';
import { appendToInbox } from '../sync/signed-append.js';
import { userIdFromEdPub } from '../sync/paths.js';
import {
  scanResourceRequests,
  scanResourceGrants,
  acceptResourceRequest,
} from './resource-requests.js';
import type { PendingRequest, ResourceRequest, ResourceGrant } from './resource-requests.js';
import type { Session } from '../sync/identity.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeUserId(edPub: string): Promise<string> {
  const bytes = hexToBytes(edPub);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}

interface KeySet {
  edPriv: string;
  edPub: string;
  userId: string;
}

async function makeKeys(): Promise<KeySet> {
  const priv = new Uint8Array(32);
  crypto.getRandomValues(priv);
  const edPriv = bytesToHex(priv);
  const edPub = bytesToHex(ed25519.getPublicKey(priv));
  const userId = await makeUserId(edPub);
  return { edPriv, edPub, userId };
}

function makeSession(keys: KeySet): Session {
  return {
    userId: keys.userId,
    name: 'test-user',
    keys: {
      edPriv: keys.edPriv,
      edPub: keys.edPub,
      kemPriv: 'deadbeef'.repeat(8),
      kemPub: 'cafebabe'.repeat(8),
    },
    ownerEdPub: keys.edPub,
    accountClient: {} as Session['accountClient'],
    chatClient: {} as Session['chatClient'],
  } as unknown as Session;
}

/** An inbox item with a sealed field and a given addedBy value. */
function makeInboxItem(addedBy: string) {
  return {
    ts: Date.now(),
    data: {
      sealed: {
        entry: { addedBy },
        ct: 'mock-ct',
      },
      ts: Date.now(),
    },
  };
}

// ── H1: acceptResourceRequest — isolated flag ─────────────────────────────────

describe('H1: acceptResourceRequest — inviteToNode isolated=true', () => {
  let ownerKeys: KeySet;
  let requesterKeys: KeySet;
  let ownerSession: Session;
  let pending: PendingRequest;

  beforeAll(async () => {
    ownerKeys = await makeKeys();
    requesterKeys = await makeKeys();
    ownerSession = makeSession(ownerKeys);
    pending = {
      req: {
        v: 1,
        kind: 'create-resource',
        reqId: 'req-h1-test',
        spaceId: 'sp-test',
        nodeType: 'ticket',
        title: 'H1 Test',
        requester: {
          userId: requesterKeys.userId,
          edPub: requesterKeys.edPub,
          kemPub: 'cafebabe'.repeat(8),
        },
      },
      senderEdPub: requesterKeys.edPub,
    };
  });

  beforeEach(() => {
    vi.mocked(createNode).mockResolvedValue({
      id: 'node-h1',
      type: 'ticket',
      title: 'H1 Test',
      access: 'invite',
      enc: false,
    } as Awaited<ReturnType<typeof createNode>>);
    vi.mocked(inviteToNode).mockResolvedValue('{"bundle":"mock"}');
    vi.mocked(appendToInbox).mockResolvedValue(undefined);
    vi.mocked(sealToRecipient).mockResolvedValue({
      entry: { addedBy: 'owner-edpub' },
      ct: 'ct',
    } as Awaited<ReturnType<typeof sealToRecipient>>);
    vi.mocked(addSpaceMember).mockResolvedValue(undefined);
  });

  it('calls inviteToNode with opts.isolated === true', async () => {
    vi.mocked(inviteToNode).mockClear();
    await acceptResourceRequest(ownerSession, pending);
    expect(inviteToNode).toHaveBeenCalledOnce();
    const call = vi.mocked(inviteToNode).mock.calls[0]!;
    // inviteToNode(session, spaceId, nodeId, requestJson, node, nodeName, opts)
    const opts = call[6];
    expect(opts?.isolated).toBe(true);
  });

  it('does NOT call addSpaceMember (isolation enforced — inviteToNode is mocked)', async () => {
    vi.mocked(addSpaceMember).mockClear();
    await acceptResourceRequest(ownerSession, pending);
    expect(addSpaceMember).not.toHaveBeenCalled();
  });

  it('inviteToNode receives serialized requester JSON (requestJson)', async () => {
    vi.mocked(inviteToNode).mockClear();
    await acceptResourceRequest(ownerSession, pending);
    const call = vi.mocked(inviteToNode).mock.calls[0]!;
    const requestJson = call[3] as string;
    const parsed = JSON.parse(requestJson) as typeof pending.req.requester;
    expect(parsed.edPub).toBe(requesterKeys.edPub);
    expect(parsed.userId).toBe(requesterKeys.userId);
  });

  it('calls inviteToNode with the correct spaceId and nodeId', async () => {
    vi.mocked(inviteToNode).mockClear();
    vi.mocked(createNode).mockResolvedValue({
      id: 'node-specific',
      type: 'ticket',
      title: 'H1 Test',
      access: 'invite',
      enc: false,
    } as Awaited<ReturnType<typeof createNode>>);
    await acceptResourceRequest(ownerSession, pending);
    const call = vi.mocked(inviteToNode).mock.calls[0]!;
    expect(call[1]).toBe('sp-test'); // spaceId
    expect(call[2]).toBe('node-specific'); // nodeId from createNode result
  });
});

// ── M2: scanResourceRequests rejects forged userId ────────────────────────────

describe('M2: scanResourceRequests — rejects forged userId', () => {
  let ownerKeys: KeySet;
  let ownerSession: Session;
  let requesterKeys: KeySet;

  beforeAll(async () => {
    ownerKeys = await makeKeys();
    requesterKeys = await makeKeys();
    ownerSession = makeSession(ownerKeys);
  });

  function makeRequest(
    requesterEdPub: string,
    requesterUserId: string,
    reqId: string,
  ): ResourceRequest {
    return {
      v: 1,
      kind: 'create-resource',
      reqId,
      spaceId: 'sp-test',
      nodeType: 'ticket',
      title: 'Test',
      requester: {
        userId: requesterUserId,
        edPub: requesterEdPub,
        kemPub: 'cafebabe'.repeat(8),
      },
    };
  }

  beforeEach(() => {
    vi.mocked(readObjectTree).mockResolvedValue([]);
  });

  it('skips items where userId does NOT match userIdFromEdPub(edPub)', async () => {
    const forgedUserId = 'ffffffffffffffffffffffffffffffff'; // not sha256(edPub)[0:32]
    const req = makeRequest(requesterKeys.edPub, forgedUserId, 'req-forged');

    vi.mocked(pullInbox)
      .mockResolvedValueOnce([makeInboxItem(requesterKeys.edPub)])
      .mockResolvedValueOnce([]);
    vi.mocked(unsealFromRecipient).mockResolvedValue(JSON.stringify(req));
    // Real userId from edPub (not the forged one) — so comparison forgedUserId !== realUserId
    vi.mocked(userIdFromEdPub).mockResolvedValue(requesterKeys.userId);

    const results = await scanResourceRequests(ownerSession);
    expect(results).toHaveLength(0);
  });

  it('accepts items where userId MATCHES userIdFromEdPub(edPub)', async () => {
    const req = makeRequest(requesterKeys.edPub, requesterKeys.userId, 'req-valid');

    // pullInbox is called once per shard (2 shards); only current shard has the item
    vi.mocked(pullInbox)
      .mockResolvedValueOnce([makeInboxItem(requesterKeys.edPub)])
      .mockResolvedValueOnce([]);
    vi.mocked(unsealFromRecipient).mockResolvedValue(JSON.stringify(req));
    vi.mocked(userIdFromEdPub).mockResolvedValue(requesterKeys.userId);

    const results = await scanResourceRequests(ownerSession);
    expect(results).toHaveLength(1);
    expect(results[0]!.req.reqId).toBe('req-valid');
  });

  it('skips items where addedBy does not match requester.edPub (sender spoof)', async () => {
    const otherKeys = await makeKeys();
    const req = makeRequest(requesterKeys.edPub, requesterKeys.userId, 'req-spoof');

    // addedBy = otherKeys.edPub but req.requester.edPub = requesterKeys.edPub
    vi.mocked(pullInbox)
      .mockResolvedValueOnce([makeInboxItem(otherKeys.edPub)])
      .mockResolvedValueOnce([]);
    vi.mocked(unsealFromRecipient).mockResolvedValue(JSON.stringify(req));
    vi.mocked(userIdFromEdPub).mockResolvedValue(requesterKeys.userId);

    const results = await scanResourceRequests(ownerSession);
    expect(results).toHaveLength(0);
  });

  it('skips items that fail unseal (trial-unseal skip)', async () => {
    vi.mocked(pullInbox)
      .mockResolvedValueOnce([makeInboxItem(requesterKeys.edPub)])
      .mockResolvedValueOnce([]);
    vi.mocked(unsealFromRecipient).mockRejectedValue(new Error('decrypt fail'));

    const results = await scanResourceRequests(ownerSession);
    expect(results).toHaveLength(0);
  });

  it('applies spaceIds allow-list filter when provided', async () => {
    const req = makeRequest(requesterKeys.edPub, requesterKeys.userId, 'req-filter');
    vi.mocked(pullInbox)
      .mockResolvedValueOnce([makeInboxItem(requesterKeys.edPub)])
      .mockResolvedValueOnce([]);
    vi.mocked(unsealFromRecipient).mockResolvedValue(JSON.stringify(req));
    vi.mocked(userIdFromEdPub).mockResolvedValue(requesterKeys.userId);

    // req.spaceId = 'sp-test' but allow-list only has 'sp-other'
    const results = await scanResourceRequests(ownerSession, new Set(['sp-other']));
    expect(results).toHaveLength(0);
  });
});

// ── L1: scanResourceGrants deduplicates by reqId ─────────────────────────────

describe('L1: scanResourceGrants — deduplicates by reqId', () => {
  let requesterKeys: KeySet;
  let requesterSession: Session;

  beforeAll(async () => {
    requesterKeys = await makeKeys();
    requesterSession = makeSession(requesterKeys);
  });

  function makeGrant(reqId: string, nodeId: string): ResourceGrant {
    return {
      v: 1,
      kind: 'grant',
      reqId,
      spaceId: 'sp-test',
      nodeId,
      bundle: '{"spaceId":"sp-test"}',
    };
  }

  it('returns only one grant when two inbox items share the same reqId', async () => {
    const grant = makeGrant('req-dup', 'node-1');

    vi.mocked(pullInbox).mockResolvedValue([
      makeInboxItem('sender1'),
      makeInboxItem('sender1'),
    ]);
    vi.mocked(unsealFromRecipient)
      .mockResolvedValueOnce(JSON.stringify(grant))
      .mockResolvedValueOnce(JSON.stringify(grant));

    const results = await scanResourceGrants(requesterSession);
    expect(results).toHaveLength(1);
    expect(results[0]!.reqId).toBe('req-dup');
  });

  it('returns multiple grants when reqIds are different', async () => {
    const grant1 = makeGrant('req-a', 'node-1');
    const grant2 = makeGrant('req-b', 'node-2');

    vi.mocked(pullInbox).mockResolvedValue([
      makeInboxItem('sender1'),
      makeInboxItem('sender1'),
    ]);
    vi.mocked(unsealFromRecipient)
      .mockResolvedValueOnce(JSON.stringify(grant1))
      .mockResolvedValueOnce(JSON.stringify(grant2));

    const results = await scanResourceGrants(requesterSession);
    expect(results).toHaveLength(2);
    const reqIds = results.map((g) => g.reqId);
    expect(reqIds).toContain('req-a');
    expect(reqIds).toContain('req-b');
  });

  it('deduplicates across shards (same reqId in current and previous shard)', async () => {
    const grant = makeGrant('req-cross-shard', 'node-x');

    // pullInbox called once per shard (2 shards), both return the same grant
    vi.mocked(pullInbox)
      .mockResolvedValueOnce([makeInboxItem('sender1')]) // current shard
      .mockResolvedValueOnce([makeInboxItem('sender1')]); // previous shard
    vi.mocked(unsealFromRecipient)
      .mockResolvedValueOnce(JSON.stringify(grant))
      .mockResolvedValueOnce(JSON.stringify(grant));

    const results = await scanResourceGrants(requesterSession);
    expect(results).toHaveLength(1);
  });

  it('skips items that cannot be unsealed', async () => {
    const grant = makeGrant('req-ok', 'node-ok');
    vi.mocked(pullInbox).mockResolvedValue([
      makeInboxItem('sender1'),
      makeInboxItem('sender1'),
    ]);
    vi.mocked(unsealFromRecipient)
      .mockRejectedValueOnce(new Error('bad seal'))
      .mockResolvedValueOnce(JSON.stringify(grant));

    const results = await scanResourceGrants(requesterSession);
    expect(results).toHaveLength(1);
    expect(results[0]!.reqId).toBe('req-ok');
  });

  it('skips items where kind is not "grant"', async () => {
    const reject = { v: 1, kind: 'reject', reqId: 'req-rej', reason: 'nope' };
    const grant = makeGrant('req-ok', 'node-ok');
    vi.mocked(pullInbox).mockResolvedValue([
      makeInboxItem('sender1'),
      makeInboxItem('sender1'),
    ]);
    vi.mocked(unsealFromRecipient)
      .mockResolvedValueOnce(JSON.stringify(reject))
      .mockResolvedValueOnce(JSON.stringify(grant));

    const results = await scanResourceGrants(requesterSession);
    expect(results).toHaveLength(1);
    expect(results[0]!.reqId).toBe('req-ok');
  });
});
