/**
 * Web (+ Node) crypto setup. WebCrypto lives on globalThis, so no patching needed;
 * only the chunked base64 provider is registered. Call before any SDK call.
 */
import { configurePlatform } from '@drakkar.software/starfish-protocol';
import { starfishBase64 } from '@drakkar.software/octospaces-sdk';

export function configureStarfishPlatform(): void {
  // The SDK's default base64 encoder spreads the whole byte array into one call
  // (`btoa(String.fromCharCode(...data))`) and overflows the stack on large
  // blobs; register a chunked provider so attachment uploads scale.
  configurePlatform({ base64: starfishBase64 });
}
