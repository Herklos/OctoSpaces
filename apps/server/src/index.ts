import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  createSyncRouter,
  createCapCertRoleResolver,
  createInMemoryNonceCache,
  createGracefulShutdown,
  saveConfig,
} from "@drakkar.software/starfish-server";
import { createEventsRoute } from "./events.js";
import { FilesystemObjectStore } from "@drakkar.software/starfish-server/node";
import { identitiesServerPlugin } from "@drakkar.software/starfish-identities";
import { sharingServerPlugin } from "@drakkar.software/starfish-sharing";
import { createQueuingServerPlugin } from "@drakkar.software/starfish-queuing";
import { createProjectionServerPlugin } from "@drakkar.software/starfish-projection";

import { config } from "./config.js";
import { projections } from "./projections.js";
import { createNatsQueue } from "./queue.js";
import { createFileRevocationStore } from "./revocation-store.js";
import { makeSpaceRoleEnricher } from "./space-role.js";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.STARFISH_DATA_DIR ?? "./data";

const CORS_ALLOW = (process.env.STARFISH_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (CORS_ALLOW.length === 0 && process.env.NODE_ENV === "production") {
  console.warn(
    "[OctoSpaces] SECURITY: STARFISH_CORS_ORIGINS is unset in production — CORS echoes any " +
      "Origin and any requested headers. Set it to your app's origin allowlist.",
  );
}

function allowOrigin(reqOrigin: string | undefined): string {
  if (CORS_ALLOW.length === 0) return reqOrigin ?? "*";
  if (reqOrigin && CORS_ALLOW.includes(reqOrigin)) return reqOrigin;
  return CORS_ALLOW[0];
}

const store = new FilesystemObjectStore({ baseDir: DATA_DIR });

// windowMs MUST be >= 2x the accepted clock-skew (DEFAULT_MAX_SKEW_MS = 5 min):
// requests are accepted across [ts - skew, ts + skew], so the nonce must live
// for the full 2x window or a replay slot re-opens.
const nonceCache = createInMemoryNonceCache({ windowMs: 10 * 60_000, maxEntries: 100_000 });
const revocationStore = createFileRevocationStore(`${DATA_DIR}/_revocations.json`);
const roleResolver = createCapCertRoleResolver({
  nonceCache,
  revocationStore,
  allowAnonymous: true, // public-read collections (profile, pairing, spaceindex)
  plugins: [identitiesServerPlugin, sharingServerPlugin],
  maxBodyBytes: 11_534_336,
});

// Publish a change-event to NATS on writes to the space registry collections
// (params {spaceId} only — no content). Whistlers re-serves these as SSE.
const { queue, nc } = await createNatsQueue();
const queuing = createQueuingServerPlugin({
  queue,
  collections: {
    // Space access record changes (member added/removed, name/image updated).
    rooms: { topic: "octospaces.space.changed", includeParams: true, includeIdentity: false },
    // Keyring changes (CEK rotation on member invite/revoke).
    chatkeyring: { topic: "octospaces.space.changed", includeParams: true, includeIdentity: false },
  },
});

// Grants `space:owner` / `space:member` by reading `spaces/{spaceId}/_rooms`.
// Shared between the sync router and the /events proxy.
const spaceEnricher = makeSpaceRoleEnricher(store);

// Upserts public-space directory entries into `_index/spaces/public` on each
// `rooms` write with `visibility:'public'`. The `spaceindex` collection is
// pullOnly — clients read it; only this projection writes it.
const projection = createProjectionServerPlugin({ store, projections });

const syncRouter = createSyncRouter({
  store,
  config,
  roleResolver,
  roleEnricher: spaceEnricher,
  plugins: [queuing, projection],
});

await saveConfig(store, config);

const app = new Hono();

app.use("*", async (c, next) => {
  const origin = allowOrigin(c.req.header("Origin"));
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": c.req.header("Access-Control-Request-Headers") ?? "*",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }
  await next();
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
});

// Authenticated SSE proxy — must be mounted before the sync router's catch-all.
app.route("/", createEventsRoute({ enricher: spaceEnricher, nonceCache, revocationStore }));

app.route("/", syncRouter as unknown as Hono);

createGracefulShutdown({
  plugins: [queuing],
  onShutdown: async () => {
    await nc?.drain();
  },
});

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`OctoSpaces Starfish server listening on http://0.0.0.0:${info.port} (data: ${DATA_DIR})`);
});
