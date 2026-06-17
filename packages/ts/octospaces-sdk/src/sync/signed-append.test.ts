/**
 * Tests for sync/signed-append.ts — postAnonymousAppend / appendToInbox.
 *
 * HTTP calls (fetchWithTimeout) are mocked so no server is needed.
 * The core assertion: the author proof signs the element bound to the documentKey
 * (inbox path), and a tampered data field fails signature verification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { verifyAppendAuthor } from '@drakkar.software/starfish-protocol';

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock fetchWithTimeout — capture what was POSTed
vi.mock('./fetch-timeout.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

// Mock configureOctoSpaces / getSyncBase / getSyncNamespace so the module loads
vi.mock('../core/config.js', () => ({
  getSyncBase: vi.fn(() => 'http://localhost:8787'),
  getSyncNamespace: vi.fn(() => undefined),
  getSyncPrefix: vi.fn(() => ''),
  getOnServerReachable: vi.fn(() => undefined),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { fetchWithTimeout } from './fetch-timeout.js';
import { postAnonymousAppend, appendToInbox, AppendHttpError } from './signed-append.js';
import { inboxPush } from './paths.js';

// ── Key helpers ───────────────────────────────────────────────────────────────

function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

function makeAuthor(): { edPubHex: string; edPrivHex: string } {
  const privBytes = new Uint8Array(32);
  crypto.getRandomValues(privBytes);
  const edPrivHex = toHex(privBytes);
  const edPubHex = toHex(ed25519.getPublicKey(privBytes));
  return { edPubHex, edPrivHex };
}

// ── Mock response helpers ─────────────────────────────────────────────────────

function okFetch(captureRef: { body: Record<string, unknown> | null }) {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    captureRef.body = JSON.parse(init.body as string) as Record<string, unknown>;
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
  });
}

function errorFetch(status: number, text = 'error') {
  return vi.fn().mockReturnValue(
    Promise.resolve({ ok: false, status, text: () => Promise.resolve(text) }),
  );
}

// ── postAnonymousAppend ───────────────────────────────────────────────────────

describe('postAnonymousAppend', () => {
  beforeEach(() => {
    vi.mocked(fetchWithTimeout).mockReset();
  });

  it('POSTs to the correct URL (syncBase + signPath)', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    const signPath = '/push/inbox/testuser/2024-06';
    await postAnonymousAppend({
      signPath,
      element: { msg: 'hello' },
      author,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe('http://localhost:8787/push/inbox/testuser/2024-06');
  });

  it('includes Content-Type: application/json header', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    await postAnonymousAppend({
      signPath: '/push/inbox/u/2024-06',
      element: { x: 1 },
      author,
    });

    const [, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');
  });

  it('POSTed body contains data field equal to the element', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    const element = { sealed: { ct: 'abc' }, ts: 12345 };
    await postAnonymousAppend({ signPath: '/push/inbox/u/2024-06', element, author });

    expect(capture.body?.data).toEqual(element);
  });

  it('POSTed body contains authorPubkey field matching author.edPubHex', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    const element = { msg: 'test' };
    await postAnonymousAppend({ signPath: '/push/inbox/u/2024-06', element, author });

    expect(capture.body?.authorPubkey).toBe(author.edPubHex);
  });

  it('author proof signature verifies against documentKey and element', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    const signPath = '/push/inbox/owner123/2024-06';
    const element = { sealed: { entry: { ct: 'xyz' } }, ts: 99 };
    await postAnonymousAppend({ signPath, element, author });

    const body = capture.body!;
    const documentKey = signPath.replace(/^\/push\//, '');
    const isValid = verifyAppendAuthor(
      documentKey,
      body.data as Record<string, unknown>,
      body.authorPubkey as string,
      body.authorSignature as string,
    );
    expect(isValid).toBe(true);
  });

  it('a tampered data field fails signature verification', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    const signPath = '/push/inbox/owner123/2024-06';
    const element = { sealed: { ct: 'original' }, ts: 1 };
    await postAnonymousAppend({ signPath, element, author });

    const body = capture.body!;
    const documentKey = signPath.replace(/^\/push\//, '');
    // Tamper the data field
    const tamperedData = { sealed: { ct: 'tampered' }, ts: 1 };
    const isValid = verifyAppendAuthor(
      documentKey,
      tamperedData,
      body.authorPubkey as string,
      body.authorSignature as string,
    );
    expect(isValid).toBe(false);
  });

  it('a tampered documentKey fails signature verification', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    const signPath = '/push/inbox/owner123/2024-06';
    const element = { x: 42 };
    await postAnonymousAppend({ signPath, element, author });

    const body = capture.body!;
    // Use a different documentKey
    const wrongDocumentKey = 'inbox/other-owner/2024-06';
    const isValid = verifyAppendAuthor(
      wrongDocumentKey,
      body.data as Record<string, unknown>,
      body.authorPubkey as string,
      body.authorSignature as string,
    );
    expect(isValid).toBe(false);
  });

  it('throws AppendHttpError on non-2xx response', async () => {
    const fetcher = errorFetch(403, 'forbidden');
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    await expect(
      postAnonymousAppend({ signPath: '/push/inbox/u/2024-06', element: {}, author }),
    ).rejects.toThrow(AppendHttpError);
  });

  it('AppendHttpError carries the HTTP status code', async () => {
    const fetcher = errorFetch(429, 'rate limited');
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    try {
      await postAnonymousAppend({ signPath: '/push/inbox/u/2024-06', element: {}, author });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppendHttpError);
      expect((e as AppendHttpError).status).toBe(429);
    }
  });
});

// ── appendToInbox ─────────────────────────────────────────────────────────────

describe('appendToInbox', () => {
  beforeEach(() => {
    vi.mocked(fetchWithTimeout).mockReset();
  });

  it('calls postAnonymousAppend with the correct inboxPush path', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    const identity = 'user-abc';
    const shard = '2024-09';
    await appendToInbox(identity, shard, { ts: 1 }, author);

    const [url] = vi.mocked(fetcher).mock.calls[0]!;
    const expectedPath = inboxPush(identity, shard);
    expect(url).toContain(expectedPath.replace(/^\/push\//, ''));
  });

  it('author proof in appendToInbox verifies correctly', async () => {
    const capture = { body: null as Record<string, unknown> | null };
    const fetcher = okFetch(capture);
    vi.mocked(fetchWithTimeout).mockReturnValue(fetcher as ReturnType<ReturnType<typeof fetchWithTimeout>>);

    const author = makeAuthor();
    const identity = 'user-xyz';
    const shard = '2024-10';
    const element = { sealed: { ct: 'test-seal' }, ts: 42 };
    await appendToInbox(identity, shard, element, author);

    const body = capture.body!;
    const documentKey = inboxPush(identity, shard).replace(/^\/push\//, '');
    const isValid = verifyAppendAuthor(
      documentKey,
      body.data as Record<string, unknown>,
      body.authorPubkey as string,
      body.authorSignature as string,
    );
    expect(isValid).toBe(true);
  });
});
