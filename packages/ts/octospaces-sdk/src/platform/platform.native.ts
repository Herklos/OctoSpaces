/**
 * Native crypto setup. Installs react-native-quick-crypto to patch
 * `globalThis.crypto` and `globalThis.Buffer` before any SDK call.
 * Requires a custom dev build (not Expo Go) + New Architecture.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — optional peer dep; only present in native builds
import { install } from 'react-native-quick-crypto';
import { configurePlatform } from '@drakkar.software/starfish-protocol';
import { starfishBase64 } from '../sync/base64.js';

install();

export function configureStarfishPlatform(): void {
  configurePlatform({ base64: starfishBase64 });
}
