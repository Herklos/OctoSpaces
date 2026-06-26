/**
 * E2EE sealed Parquet upload/download for the `objparquetenc` collection.
 *
 * Parquet bytes are AES-256-GCM-sealed under the space keyring CEK before
 * upload; the server and S3 only ever see ciphertext.  The storage path
 * (`objectParquetEncName`) is bound into the seal AAD, preventing ciphertext
 * relocation to a different objectId.
 *
 * **Trade-off:** the stored bytes are NOT valid Parquet files — DuckDB cannot
 * read them via `read_parquet('s3://…')`.  Members must pull → unseal →
 * load into DuckDB-WASM (or another in-process engine) to query.
 *
 * For plaintext (queryable) parquet datasets use `objparquet` / `objparquetpub`
 * instead.  For unencrypted binary files use `objblob` / `uploadObjectBlob`.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';
import { sealAndPushBlob, pullAndOpenBlob } from '@drakkar.software/starfish-client';
import type { ByteSealer } from '@drakkar.software/starfish-client';
import { randomId } from '@drakkar.software/starfish-protocol';

import { objectParquetEncName, objectParquetEncPull, objectParquetEncPush } from './paths.js';
import { FileTooLargeError } from './object-blobs.js';

/**
 * Maximum allowed byte size for a single sealed Parquet upload.
 *
 * 64 MiB minus 32 bytes of AES-GCM overhead headroom so the sealed ciphertext
 * also fits within the server's 64 MiB `maxBodyBytes` limit for `objparquetenc`.
 * Keep in sync with `maxBodyBytes` in `apps/server/src/config.ts`.
 */
export const MAX_OBJECT_PARQUET_ENC_BYTES = 67_108_800; // 64 MiB − 32 B

/**
 * Seal `bytes` (a Parquet file) under the space keyring CEK and upload to the
 * `objparquetenc` collection.
 *
 * @param client   - A connected `StarfishClient`.
 * @param enc      - A `ByteSealer` (e.g. `KeyringEncryptor` from `starfish-keyring`).
 * @param spaceId  - The space the dataset belongs to.
 * @param bytes    - Plaintext Parquet bytes to seal and upload.
 * @param objectId - Optional stable ID for this dataset.  Defaults to a new `randomId()`.
 * @returns The objectId — store it to load the dataset later with {@link loadObjectParquetEnc}.
 *
 * @throws {@link FileTooLargeError} if `bytes.length` exceeds {@link MAX_OBJECT_PARQUET_ENC_BYTES}.
 */
export async function uploadObjectParquetEnc(
  client: StarfishClient,
  enc: ByteSealer,
  spaceId: string,
  bytes: Uint8Array,
  objectId: string = randomId(),
): Promise<string> {
  if (bytes.length > MAX_OBJECT_PARQUET_ENC_BYTES) {
    throw new FileTooLargeError(bytes.length, MAX_OBJECT_PARQUET_ENC_BYTES);
  }
  const aad = objectParquetEncName(spaceId, objectId);
  await sealAndPushBlob(client, enc, objectParquetEncPush(spaceId, objectId), bytes, { aad });
  return objectId;
}

/**
 * Pull and unseal a sealed Parquet dataset from the `objparquetenc` collection.
 *
 * @param client   - A connected `StarfishClient`.
 * @param enc      - A `ByteSealer` matching the one used during upload.
 * @param spaceId  - The space the dataset belongs to.
 * @param objectId - The objectId returned by {@link uploadObjectParquetEnc}.
 * @returns The original plaintext Parquet bytes.
 *
 * @throws if the ciphertext is invalid, tampered with, or the AAD does not match.
 */
export async function loadObjectParquetEnc(
  client: StarfishClient,
  enc: ByteSealer,
  spaceId: string,
  objectId: string,
): Promise<Uint8Array> {
  const aad = objectParquetEncName(spaceId, objectId);
  return pullAndOpenBlob(client, enc, objectParquetEncPull(spaceId, objectId), { aad });
}
