/**
 * Anonymous signed append — POST one JSON element to a public-write collection with
 * the requester's own Ed25519 author proof and NO cap/auth headers.
 *
 * `StarfishClient.append`/`push` always attaches a cap-signed Authorization header
 * (see `capProviderFor` in `client.ts`). The `inbox/{identity}/{shard}` collection
 * is `writeRoles:["public"]` — appending with a cap header would fail its path-scope
 * check. We POST directly via `fetch`, signing only the append-author proof (bound to
 * the document key, not to a request auth path) with the sender's own key.
 *
 * The inbox collection sets `requireAuthorSignature: false`, so the proof is optional
 * server-side, but we sign it anyway for parity with the OctoChat server config and to
 * surface the sender's edPub via `sealed.entry.addedBy` in the receive path.
 */
import { signAppendAuthor } from '@drakkar.software/starfish-protocol';

import { getSyncBase, getSyncNamespace } from '../core/config.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { inboxPush } from './paths.js';

/** A non-2xx response from {@link appendToInbox}. */
export class AppendHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppendHttpError';
  }
}

function actionPathFor(signPath: string): string {
  const ns = getSyncNamespace();
  return (ns ? `/v1/${ns}` : '') + signPath;
}

/**
 * POST one element to a public-write collection with no auth headers — the
 * anonymous inbox push. Signs the append-author proof with `author` (optional per
 * the inbox collection config, but signed for provenance).
 *
 * @param signPath  Full server-relative push path (e.g. from `inboxPush(id, shard)`).
 * @param element   The JSON element to append (`{ sealed, ts }`).
 * @param author    The sender's Ed25519 key pair — signs the author proof.
 */
export async function postAnonymousAppend(opts: {
  signPath: string;
  element: Record<string, unknown>;
  author: { edPubHex: string; edPrivHex: string };
  failurePrefix?: string;
}): Promise<void> {
  const actionPath = actionPathFor(opts.signPath);
  const url = `${getSyncBase().replace(/\/+$/, '')}${actionPath}`;
  // documentKey = the part after /push/; bound into the author proof.
  const documentKey = opts.signPath.replace(/^\/push\//, '');
  const author = signAppendAuthor(
    documentKey,
    opts.element,
    opts.author.edPubHex,
    opts.author.edPrivHex,
  );
  const body = JSON.stringify({ data: opts.element, ...author });
  const res = await fetchWithTimeout()(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AppendHttpError(
      res.status,
      `${opts.failurePrefix ?? 'anonymous append'} failed: HTTP ${res.status} ${detail}`,
    );
  }
}

/**
 * Anonymously append a sealed element to an identity's inbox shard.
 *
 * @param identity  The inbox owner's userId (`inbox/{identity}/{shard}`).
 * @param shard     UTC `YYYY-MM` shard from {@link inboxShard}.
 * @param element   The element to append (typically `{ sealed: SealedBlob, ts: number }`).
 * @param author    Sender's key pair — signs the append-author proof.
 */
export async function appendToInbox(
  identity: string,
  shard: string,
  element: Record<string, unknown>,
  author: { edPubHex: string; edPrivHex: string },
): Promise<void> {
  await postAnonymousAppend({
    signPath: inboxPush(identity, shard),
    element,
    author,
    failurePrefix: 'inbox append',
  });
}
