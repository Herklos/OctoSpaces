/**
 * Parse an invite (pasted text or a `#fragment` deep link) into a preview the
 * join screen can show on a consent card — name, type, identifying fingerprint
 * — WITHOUT joining. Actual join calls (`joinSpaceByLink`, `joinNodeByLink`,
 * `acceptSpaceInvite`, `acceptNodeInvite`) only run after the user confirms.
 *
 * Accepts three input forms:
 *   - A space invite link (URL fragment encoded by `createSpaceInviteLink`)
 *   - A node invite link (URL fragment encoded by `createNodeInviteLink`)
 *   - A private member-bundle JSON minted by `inviteToSpace`
 */
import { decodeSpaceInviteLink, decodeNodeInviteLink } from '@drakkar.software/starfish-spaces';
import type { SpaceInviteLinkToken, NodeInviteLinkToken } from '@drakkar.software/starfish-spaces';

export type { SpaceInviteLinkToken, NodeInviteLinkToken };

export type InvitePreview =
  | {
      kind: 'space-link';
      spaceName: string;
      /** True if the link grants write access, false for read-only. */
      write: boolean;
      token: SpaceInviteLinkToken;
    }
  | {
      kind: 'node-link';
      spaceName: string;
      /** The node's display name, absent for legacy tokens that omit it. */
      nodeTitle?: string;
      token: NodeInviteLinkToken;
    }
  | {
      kind: 'member-bundle';
      spaceName: string;
      spaceId: string;
      /** Short hex fingerprint of the issuing owner's signing key, or null if absent. */
      issuerKey: string | null;
      /** The raw cap-bundle JSON — pass verbatim to `acceptSpaceInvite` on consent. */
      inviteJson: string;
    };

/** Shape of the private invite bundle minted by `inviteToSpace`. */
interface PrivateInviteShape {
  spaceId?: string;
  spaceName?: string;
  cap?: { kind?: string; iss?: string };
}

/**
 * Classify and decode an invite string into a typed {@link InvitePreview}.
 * Throws a human-readable `Error` on invalid input (safe to surface verbatim
 * in a toast or inline error message).
 */
export function previewInvite(raw: string): InvitePreview {
  const text = raw.trim();
  if (!text) throw new Error('Paste an invite link or code first.');

  // Invite links carry their credential in a URL fragment.
  if (text.includes('#')) {
    const fragment = text.slice(text.indexOf('#'));
    // Try node-invite link first — it has a `nodeId` field the space link lacks.
    try {
      const token = decodeNodeInviteLink(fragment);
      return {
        kind: 'node-link',
        spaceName: `space-${token.spaceId.slice(-6)}`,
        nodeTitle: token.nodeName,
        token,
      };
    } catch {
      // fall through to space link
    }
    try {
      const token = decodeSpaceInviteLink(fragment);
      return { kind: 'space-link', spaceName: token.spaceName, write: token.write, token };
    } catch {
      throw new Error('That invite link appears to be invalid or expired.');
    }
  }

  // Private member-bundle JSON minted by `inviteToSpace`.
  let parsed: PrivateInviteShape;
  try {
    parsed = JSON.parse(text) as PrivateInviteShape;
  } catch {
    throw new Error("That doesn't look like an invite. Paste the full invite code or link.");
  }
  if (!parsed?.spaceId || parsed.cap?.kind !== 'member') {
    throw new Error('That is not a valid space invite.');
  }
  const iss = parsed.cap?.iss;
  return {
    kind: 'member-bundle',
    spaceName: parsed.spaceName?.trim() || `space-${parsed.spaceId.slice(-6)}`,
    spaceId: parsed.spaceId,
    issuerKey: typeof iss === 'string' && iss.length >= 8 ? `${iss.slice(0, 8)}…${iss.slice(-8)}` : null,
    inviteJson: text,
  };
}
