/**
 * Owner trusted-adder allow-list for opening/sealing an OWNED keyring.
 *
 * Pure and import-free on purpose: both `client.ts` and `identity.ts` need this
 * computation, but `identity.ts` already imports from `client.ts`, so a helper
 * living in either would create an import cycle. Keeping it in its own leaf module
 * lets both depend on it cycle-free.
 *
 * When the owner key equals the device key (the common single-device case) the
 * allow-list is just `[selfEdPub]`; otherwise the owner key is also trusted so a
 * paired device can open keyrings sealed by the root identity.
 */
export function computeOwnerTrustedAdders(ownerEdPub: string | undefined, selfEdPub: string): string[] {
  const owner = ownerEdPub ?? selfEdPub;
  return owner !== selfEdPub ? [owner, selfEdPub] : [selfEdPub];
}
