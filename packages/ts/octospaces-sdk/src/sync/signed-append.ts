/**
 * Anonymous signed append — POST one JSON element to a public-write collection
 * with the requester's own Ed25519 author proof and NO cap/auth headers.
 *
 * Delegates to StarfishClient.appendAnonymous, which signs the append-author
 * proof internally (signAppendAuthor bound to the document key) and POSTs
 * { data, authorPubkey, authorSignature } without an Authorization header.
 *
 * AppendHttpError (re-exported from starfish-client) is thrown on any non-2xx
 * response; callers that catch it should import the type from here or directly
 * from @drakkar.software/starfish-client.
 */
import { StarfishClient } from '@drakkar.software/starfish-client';
import { createTimeoutFetch } from '@drakkar.software/starfish-client/fetch';
export { AppendHttpError } from '@drakkar.software/starfish-client';

import { getSyncBase, getSyncNamespace } from '../core/config.js';
import { inboxPush } from './paths.js';

/** 12 s connect cap — consistent with the pairing client. */
const CONNECT_TIMEOUT_MS = 12_000;

function makeAnonClient(): StarfishClient {
  return new StarfishClient({
    baseUrl: getSyncBase(),
    namespace: getSyncNamespace() ?? undefined,
    fetch: createTimeoutFetch(CONNECT_TIMEOUT_MS),
  });
}

/**
 * Anonymously append a sealed element to an identity's inbox shard.
 *
 * The inbox collection is `writeRoles:["public"]` — no cap header is sent.
 * The Ed25519 author proof (signed by `author`) is bound to the document key
 * and surfaces the sender's edPub via `sealed.entry.addedBy` in the receive path.
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
  await makeAnonClient().appendAnonymous(inboxPush(identity, shard), element, author);
}
