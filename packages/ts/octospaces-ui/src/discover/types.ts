/**
 * Shared entry type for the generic Discover surface.
 *
 * Structurally compatible with `PublicObjectDirEntry` from
 * `@drakkar.software/octospaces-sdk` (which adds the same fields). Apps pass
 * `readObjectDirectory()` results directly to `loadEntries`; no runtime
 * conversion needed.
 */
export interface DiscoverEntry {
  /** The space this object belongs to. */
  spaceId: string;
  /** The object's node id. */
  id: string;
  /** Display title (empty string when the server stripped it). */
  title: string;
  /** The node type (e.g. `'page'`, `'board'`, `'task'`). */
  type: string;
  /** Optional emoji short-code or unicode character shown before the title. */
  emoji?: string;
  /** Server-side last-updated timestamp (epoch ms). */
  updatedAt?: number;
}
