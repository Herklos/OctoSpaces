/**
 * Generic compare-and-swap write with conflict-retry — the shared skeleton behind
 * every `_spaces` / object-index read-modify-write.
 *
 * Pull the current state + its CAS hash, build the next payload (or `null` to skip the
 * write as a no-op), push it guarded by that hash, and retry the whole cycle on a
 * `ConflictError` up to {@link CAS_MAX_ATTEMPTS} times (a concurrent writer landed first —
 * re-pull and re-apply). Any other error, or a conflict on the final attempt, propagates.
 */
import { ConflictError } from '@drakkar.software/starfish-client';

export const CAS_MAX_ATTEMPTS = 3;

export async function casMutateWithRetry<Ctx, P>(opts: {
  /** Pull the current state and its CAS hash (null when the doc doesn't exist yet). */
  load: () => Promise<{ ctx: Ctx; hash: string | null }>;
  /** Build the push payload from the pulled state, or `null` to skip the write. */
  build: (ctx: Ctx) => P | null;
  /** Push the built payload, guarded by the pulled hash. */
  push: (payload: P, hash: string | null) => Promise<unknown>;
}): Promise<void> {
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
    const { ctx, hash } = await opts.load();
    const next = opts.build(ctx);
    if (next === null) return;
    try {
      await opts.push(next, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < CAS_MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}
