import type { Projection } from "@drakkar.software/starfish-projection";

/**
 * Projections for the shared `octospaces` namespace.
 *
 * The `octospaces` namespace is a minimal cross-app registry (spaces, spaceregistry,
 * spacekeyring, profile, devices, pairing). Public-node discovery — projecting
 * `objindex` writes into a world-readable `_index/objects/public` directory — belongs
 * in each app's own namespace alongside its `objindex` collection, not here.
 *
 * `projections` is therefore empty.
 *
 * Keep in sync with Infra/sync/server/drakkar_sync/apps/octospaces/projections.py.
 */
export const projections: Projection[] = [];
