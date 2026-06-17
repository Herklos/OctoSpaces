/**
 * `WalSnapshotStore` over a regular LWW document at `<documentKey>__snapshot`.
 *
 * The snapshot is a normal (non-append) collection: we pull the current doc
 * (caching its `hash` for the next conflict-checked push) and push the
 * WAL-produced {@link WalSnapshotDoc} verbatim — it already carries its own
 * `producedBy` + author signature for the reader to verify.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';
import type { WalSnapshotDoc, WalSnapshotStore } from '@drakkar.software/starfish-wal';

export function createWalSnapshotStore(client: StarfishClient): WalSnapshotStore {
  const hashes = new Map<string, string | null>();
  return {
    async read(snapshotKey) {
      const res = await client.pull(`/pull/${snapshotKey}`).catch(() => null);
      hashes.set(snapshotKey, res?.hash ?? null);
      const data = res?.data as Partial<WalSnapshotDoc> | undefined;
      if (!data || typeof data.uptoTs !== 'number' || !data.state) return null;
      return data as WalSnapshotDoc;
    },
    async write(snapshotKey, doc) {
      // CAS push with retry: re-pull the current hash before each attempt so
      // concurrent writers don't permanently 409 each other. Snapshots are
      // infrequent so the extra round-trip(s) are cheap.
      const MAX_ATTEMPTS = 3;
      let lastErr: unknown;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let base = hashes.get(snapshotKey) ?? null;
        try {
          const cur = await client.pull(`/pull/${snapshotKey}`);
          base = cur.hash ?? null;
        } catch {
          /* use cached hash if the pull fails */
        }
        try {
          const res = await client.push(
            `/push/${snapshotKey}`,
            doc as unknown as Record<string, unknown>,
            base,
          );
          hashes.set(snapshotKey, res.hash ?? null);
          return; // success
        } catch (err) {
          lastErr = err;
          hashes.delete(snapshotKey); // force re-pull on next attempt
          if (!/conflict|stale|412|409/i.test(String(err))) throw err;
          // Conflict — another writer won; retry with fresh hash
        }
      }
      throw lastErr;
    },
  };
}
