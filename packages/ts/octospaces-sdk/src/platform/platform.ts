/**
 * Web (+ Node) crypto setup. WebCrypto lives on globalThis, so no patching needed;
 * only the chunked base64 provider is registered. Call before any SDK call.
 */
import { configurePlatform } from '@drakkar.software/starfish-protocol';
import { starfishBase64 } from '../sync/base64.js';

export function configureStarfishPlatform(): void {
  configurePlatform({ base64: starfishBase64 });
}
