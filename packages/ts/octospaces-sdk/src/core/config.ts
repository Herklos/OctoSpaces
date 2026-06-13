/**
 * Runtime configuration for the OctoSpaces SDK — the Starfish sync server URL,
 * optional namespace, events-stream URL, and public web origin.
 *
 * The SDK is headless and platform-agnostic, so it does NOT read environment
 * variables itself. The host app reads its own env (e.g. Expo `EXPO_PUBLIC_*`) and
 * calls {@link configureOctoSpaces} once at boot, before any sync/identity API runs.
 * Getters throw a clear error if called before configuration so a misconfigured
 * host fails fast rather than silently signing the wrong path.
 */
export interface OctoSpacesConfig {
  /** Starfish sync server base URL (e.g. `http://localhost:8787`). */
  syncBase: string;
  /** Bare namespace name; the SDK prepends `/v1/<namespace>` to signed paths.
   *  Unset for a root-mounted (local dev) server. */
  syncNamespace?: string;
  /**
   * Optional SEPARATE namespace for cross-app shared-spaces storage. When set,
   * space registry ops use this namespace instead of `syncNamespace`, enabling a
   * single shared space list across multiple app namespaces (e.g. OctoChat and
   * OctoVault sharing spaces at `/v1/shared`). If unset, falls back to the default
   * namespace for all operations (single-app behavior).
   */
  sharedSpacesNamespace?: string;
  /** Override the live change-event SSE endpoint. Defaults to
   *  `${syncBase}${syncPrefix}/events`. */
  eventsUrl?: string;
  /** Public origin of the web app, used to build shareable invite links on
   *  platforms without `window.location` (native). Empty by default. */
  webBase?: string;
  /**
   * Called when a background Starfish revalidation succeeds after a 429/5xx
   * cache-fallback (stale-while-revalidate). Use it to signal that the server
   * is reachable again so any stale views re-pull and recover.
   */
  onServerReachable?: () => void;
}

let cfg: OctoSpacesConfig | null = null;

/** Configure the SDK. Call once at app boot before any sync/identity API. */
export function configureOctoSpaces(config: OctoSpacesConfig): void {
  // Guard against the common mistake of passing `namespace` (wrong key) instead of
  // `syncNamespace`. TypeScript's excess-property check is bypassed when the config
  // is assembled via a conditional spread, so the wrong key would be silently ignored.
  if ('namespace' in config && !config.syncNamespace) {
    throw new Error(
      `octospaces-sdk: configureOctoSpaces received "namespace" — did you mean "syncNamespace"?`,
    );
  }
  const ns = (config.syncNamespace ?? '').trim();
  if (ns !== '' && !/^[A-Za-z0-9_-]+$/.test(ns)) {
    throw new Error(`octospaces-sdk: syncNamespace must be a bare name ([A-Za-z0-9_-]+), got "${ns}"`);
  }
  const sharedNs = (config.sharedSpacesNamespace ?? '').trim();
  if (sharedNs !== '' && !/^[A-Za-z0-9_-]+$/.test(sharedNs)) {
    throw new Error(`octospaces-sdk: sharedSpacesNamespace must be a bare name ([A-Za-z0-9_-]+), got "${sharedNs}"`);
  }
  cfg = {
    ...config,
    syncNamespace: ns || undefined,
    sharedSpacesNamespace: sharedNs || undefined,
  };
}

function req(): OctoSpacesConfig {
  if (!cfg) throw new Error('octospaces-sdk: configureOctoSpaces() not called — wire it at app boot.');
  return cfg;
}

/** Starfish sync server base URL. */
export const getSyncBase = (): string => req().syncBase;
/** Bare namespace name (or `undefined` for a root-mounted server). */
export const getSyncNamespace = (): string | undefined => req().syncNamespace;
/** Namespaced path prefix (`/v1/<namespace>`, or `''` locally). */
export const getSyncPrefix = (): string => {
  const ns = req().syncNamespace;
  return ns ? `/v1/${ns}` : '';
};
/** Optional separate namespace for shared-spaces storage. `undefined` means use the default namespace. */
export const getSharedSpacesNamespace = (): string | undefined => cfg?.sharedSpacesNamespace;
/** Live change-event SSE endpoint. */
export const getEventsUrl = (): string => req().eventsUrl ?? `${getSyncBase()}${getSyncPrefix()}/events`;
/** Public web origin (right-trimmed of trailing slashes; `''` by default). */
export const getWebBase = (): string => (req().webBase ?? '').replace(/\/+$/, '');
/** Callback to invoke when a background Starfish revalidation succeeds. */
export const getOnServerReachable = (): (() => void) | undefined => cfg?.onServerReachable;
