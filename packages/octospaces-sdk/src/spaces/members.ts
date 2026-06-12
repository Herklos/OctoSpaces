/**
 * Space membership (space-wide keyring model).
 *
 * A *join request* is the invitee's identity (Ed/KEM pubkeys + userId). An *invite*
 * makes them a member of a whole SPACE: they're added to the space's keyring (so they
 * can decrypt every object in the space) and to its owner-written roster (so the server
 * grants them `space:member`), and handed a single space-scoped cap.
 */
import { addCollectionRecipient } from '@drakkar.software/starfish-keyring';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';

import type { Space } from '../core/types.js';
import { buildEncryptor, makeClient } from '../sync/client.js';
import type { Session } from '../sync/identity.js';
import { getMemberCap, saveMemberCap } from '../sync/member-caps.js';
import { keyringName, spaceMemberScope } from '../sync/paths.js';
import { addJoinedSpaceWithCap, addSpaceMember, readSpaces } from './registry.js';

export interface JoinRequest {
  edPub: string;
  kemPub: string;
  userId: string;
}

export function makeJoinRequest(session: Session): string {
  const req: JoinRequest = { edPub: session.keys.edPub, kemPub: session.keys.kemPub, userId: session.userId };
  return JSON.stringify(req);
}

interface SpaceInvite {
  spaceId: string;
  spaceName: string;
  cap: unknown;
}

function isAlreadyPresentRecipient(err: unknown): boolean {
  return err instanceof Error && /already present in epoch/.test(err.message);
}

/**
 * Owner-side: add a recipient's KEM key to a SPACE keyring (one keyring → every
 * object in the space). The caller must OWN the keyring — this is `space:owner`-gated
 * server-side. Reused by {@link inviteToSpace} and by device pairing.
 */
export async function addDeviceToSpaceKeyring(
  session: Session,
  spaceId: string,
  recipient: { kemPub: string; userId: string },
): Promise<void> {
  try {
    await addCollectionRecipient(
      session.chatClient,
      keyringName(spaceId),
      { subKem: recipient.kemPub, userId: recipient.userId, label: recipient.userId.slice(0, 8) },
      { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
      { trustedAdders: [session.keys.edPub] },
    );
  } catch (err) {
    if (!isAlreadyPresentRecipient(err)) throw err;
  }
}

/**
 * Owner: invite an identity into a space. Adds them to the space keyring, records
 * them in the roster (gates `space:member`), and mints a single space-scoped member
 * cap. Returns the invite bundle JSON.
 */
export async function inviteToSpace(
  session: Session,
  spaceId: string,
  requestJson: string,
  canWrite = true,
  spaceName?: string,
): Promise<string> {
  const req = JSON.parse(requestJson) as JoinRequest;
  if (!req.edPub || !req.kemPub || !req.userId) throw new Error('That is not a valid join request.');
  await addDeviceToSpaceKeyring(session, spaceId, { kemPub: req.kemPub, userId: req.userId });
  await addSpaceMember(session.accountClient, spaceId, session.userId, req.userId);
  // NOTE: 'chat' is the cap collection the deployed server's space-member enricher recognises.
  // Consumer apps targeting a different server may need to override this collection name.
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: req.edPub, kemPubHex: req.kemPub, userIdHex: req.userId },
    'chat',
    spaceMemberScope(spaceId, canWrite),
  );
  let name = spaceName?.trim();
  if (!name) {
    const { spaces } = await readSpaces(session.accountClient, session.userId);
    name = spaces.find((s) => s.id === spaceId)?.name ?? 'Space';
  }
  const invite: SpaceInvite = { spaceId, spaceName: name, cap };
  return JSON.stringify(invite);
}

/**
 * Invitee: accept a space invite — verify keyring access with the cap, store it,
 * and register the space in your own list. Returns the joined space.
 */
export async function acceptSpaceInvite(session: Session, inviteJson: string): Promise<Space> {
  const inv = JSON.parse(inviteJson) as Partial<SpaceInvite>;
  const cap = inv.cap as { kind?: string; sub?: string; iss?: string } | undefined;
  if (!cap || !inv.spaceId) throw new Error('That is not a valid space invite.');
  if (cap.kind !== 'member') throw new Error('That is not a valid space invite.');
  if (!cap.sub || cap.sub !== session.keys.edPub) {
    throw new Error('This invite was issued for a different identity.');
  }
  if (!cap.iss) throw new Error('This invite is missing its issuer.');
  const spaceId = inv.spaceId;
  const client = makeClient(cap, session.keys.edPriv);
  const enc = await buildEncryptor(client, session.keys, spaceId, [cap.iss]);
  if (!enc) throw new Error("Accepted, but you're not in the space keyring yet — ask the owner to re-invite.");
  const capJson = JSON.stringify(cap);
  const name = inv.spaceName?.trim() || `space-${spaceId.slice(-6)}`;
  const space: Space = { id: spaceId, name, short: name.slice(0, 2).toUpperCase(), members: 1 };
  await addJoinedSpaceWithCap(session.accountClient, session.userId, space, capJson);
  saveMemberCap(spaceId, capJson);
  return space;
}

export { getMemberCap };
