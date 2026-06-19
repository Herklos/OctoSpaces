/**
 * Shared verification for join / resource requests.
 *
 * The kemSig check below is identical across `inviteToSpace` (members.ts),
 * `inviteToNode` (nodes.ts) and `scanResourceRequests` (resource-requests.ts);
 * centralising it keeps the single security-critical implementation in one place.
 * Each caller keeps its OWN userId-derivation check and its OWN control flow
 * (throw with a caller-specific message vs. `continue`), which differ by context.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@drakkar.software/starfish-keyring';

/**
 * True iff `kemSig` is a valid Ed25519 signature of `kemPub` (its bytes) by the
 * private key behind `edPub`. Proves the requester owns edPub AND authored kemPub,
 * blocking a MITM from substituting their own kemPub to read content sealed for the
 * requester. Returns false on a missing sig or malformed hex (never throws).
 */
export function verifyKemSig(edPub: string, kemPub: string, kemSig: string | undefined): boolean {
  try {
    return !!kemSig && ed25519.verify(hexToBytes(kemSig), hexToBytes(kemPub), hexToBytes(edPub));
  } catch {
    return false; // malformed hex — treat as invalid
  }
}
