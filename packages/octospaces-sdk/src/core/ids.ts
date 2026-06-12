/**
 * Identifier helpers — one source for unguessable ids.
 *
 * `randomId()` is a CSPRNG-backed 128-bit id (16 random bytes, hex). Use it for
 * EVERY storage/space/room/object/blob id. Hex output is path-safe and server-safe.
 */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Slug for the human part of an id (e.g. `<spaceId>-<slug>-<ts>`). Restricted to
 * URL-clean `[a-z0-9-]` so the id is safe as both a URL path segment and a
 * server storage-path leaf (the server's FilesystemObjectStore rejects any key
 * outside `[a-zA-Z0-9._:@/-]`). Falls back to `'room'` when a name strips to nothing.
 */
export function roomSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'room'
  );
}
