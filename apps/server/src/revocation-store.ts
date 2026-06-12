/**
 * File-backed revocation store. Persists accepted revocation lists next to the
 * filesystem object store and replays them on boot, so a server restart doesn't
 * silently un-revoke members. `isRevoked` stays in-memory and O(1); only
 * `acceptList` (rare) touches disk. The atomic write (tmp → rename) prevents a
 * crash mid-write from leaving a truncated file that would un-revoke everyone.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createInMemoryRevocationStore,
  type RevocationList,
  type RevocationStore,
} from "@drakkar.software/starfish-server";

export function createFileRevocationStore(
  filePath: string,
  opts: { maxIssuers?: number } = {},
): RevocationStore {
  const inner = createInMemoryRevocationStore(opts);
  const lists = new Map<string, RevocationList>();

  try {
    const arr = JSON.parse(readFileSync(filePath, "utf8")) as RevocationList[];
    for (const list of arr) {
      if (inner.acceptList(list).ok) lists.set(list.iss, list);
    }
  } catch {
    /* no file yet → start empty */
  }

  function persist(): void {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify([...lists.values()]));
    renameSync(tmp, filePath);
  }

  return {
    isRevoked: (iss, capSub, capNonce) => inner.isRevoked(iss, capSub, capNonce),
    acceptList: (list) => {
      const res = inner.acceptList(list);
      if (!res.ok) return res;
      lists.set(list.iss, list);
      try {
        persist();
      } catch (e) {
        console.error(`[OctoSpaces] revocation-store: failed to persist ${filePath}:`, e);
      }
      return res;
    },
  };
}
