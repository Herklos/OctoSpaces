/**
 * Tests for sync/signed-append.ts — appendToInbox.
 *
 * StarfishClient is mocked to avoid a real network call. The core assertion is
 * that appendToInbox routes to the correct inboxPush path with the given
 * element + author. Signature correctness is tested upstream in starfish-client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@drakkar.software/starfish-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@drakkar.software/starfish-client')>();
  return {
    ...original,
    StarfishClient: vi.fn().mockImplementation(() => ({
      appendAnonymous: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('@drakkar.software/starfish-client/fetch', () => ({
  createTimeoutFetch: vi.fn(() => globalThis.fetch),
}));

vi.mock('../../src/core/config.js', () => ({
  getSyncBase: vi.fn(() => 'http://localhost:8787'),
  getSyncNamespace: vi.fn(() => undefined),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { StarfishClient, AppendHttpError } from '@drakkar.software/starfish-client';
import { appendToInbox } from '../../src/sync/signed-append.js';
import { inboxPush } from '../../src/sync/paths.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function lastInstance(): { appendAnonymous: ReturnType<typeof vi.fn> } {
  const calls = vi.mocked(StarfishClient).mock.results;
  return calls[calls.length - 1]!.value as { appendAnonymous: ReturnType<typeof vi.fn> };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('appendToInbox', () => {
  beforeEach(() => {
    vi.mocked(StarfishClient).mockClear();
  });

  it('calls appendAnonymous with inboxPush(identity, shard) path', async () => {
    const element = { ts: 42 };
    const author = { edPubHex: 'a'.repeat(64), edPrivHex: 'b'.repeat(64) };
    await appendToInbox('user-123', '2024-09', element, author);

    const { appendAnonymous } = lastInstance();
    expect(appendAnonymous).toHaveBeenCalledOnce();
    expect(appendAnonymous).toHaveBeenCalledWith(
      inboxPush('user-123', '2024-09'),
      element,
      author,
    );
  });

  it('propagates errors thrown by appendAnonymous', async () => {
    const err = new Error('network failure');
    vi.mocked(StarfishClient).mockImplementationOnce(() => ({
      appendAnonymous: vi.fn().mockRejectedValue(err),
    }) as unknown as InstanceType<typeof StarfishClient>);

    await expect(
      appendToInbox('u', '2024-01', {}, { edPubHex: 'a'.repeat(64), edPrivHex: 'b'.repeat(64) }),
    ).rejects.toBe(err);
  });

  it('constructs a StarfishClient with the configured base URL', async () => {
    await appendToInbox('u', '2024-01', {}, { edPubHex: 'a'.repeat(64), edPrivHex: 'b'.repeat(64) });
    expect(vi.mocked(StarfishClient)).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://localhost:8787' }),
    );
  });
});

describe('AppendHttpError (re-exported from starfish-client)', () => {
  it('is the AppendHttpError class from starfish-client', () => {
    expect(AppendHttpError).toBeDefined();
    expect(typeof AppendHttpError).toBe('function');
  });
});
