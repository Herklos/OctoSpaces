/**
 * {@link SpaceAccessError} — a GENUINE access denial (not a transient connectivity failure).
 *
 * Lives in its own dependency-free module so both the low-level keyring opener
 * (`client.ts`) and the higher-level space-encryptor cache (`space-encryptor.ts`) can
 * throw it without an import cycle.
 */
export class SpaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpaceAccessError';
  }
}
