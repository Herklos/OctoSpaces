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
import { createSpacesRoleEnricher, createSpacesDirectoryServerPlugin } from "@drakkar.software/starfish-spaces";

import { config } from "./config.js";
import { projections } from "./projections.js";
import { createNatsQueue } from "./queue.js";
import { createFileRevocationStore } from "./revocation-store.js";

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
  allowAnonymous: true, // public-read collections (profile, pairing)
  plugins: [identitiesServerPlugin, sharingServerPlugin],
  maxBodyBytes: 11_534_336,
});

// Publish change-events to NATS. Whistlers re-serves these as SSE.
// Structural changes → octospaces.object.changed (no identity).
// Append-log writes  → octospaces.log.changed    (includeIdentity for FCM push).
const { queue, nc } = await createNatsQueue();
const queuing = createQueuingServerPlugin({
  queue,
  collections: {
    // Structural changes → object topic (no identity)
    spaceregistry: { topic: "octospaces.object.changed", includeParams: true, includeIdentity: false },
    spacekeyring:  { topic: "octospaces.object.changed", includeParams: true, includeIdentity: false },
    objindex:      { topic: "octospaces.object.changed", includeParams: true, includeIdentity: false },
    objdoc:        { topic: "octospaces.object.changed", includeParams: true, includeIdentity: false },
    objpub:        { topic: "octospaces.object.changed", includeParams: true, includeIdentity: false },
    typeindex:     { topic: "octospaces.object.changed", includeParams: true, includeIdentity: false },
    // Append-log writes → log topic (includeIdentity for FCM push notifications)
    objlog:    { topic: "octospaces.log.changed", includeParams: true, includeIdentity: true },
    objpublog: { topic: "octospaces.log.changed", includeParams: true, includeIdentity: true },
    objinvlog: { topic: "octospaces.log.changed", includeParams: true, includeIdentity: true },
  },
});

// Grants `space:owner` / `space:member` by reading `spaces/{spaceId}/_access`.
// Shared between the sync router and the /events proxy.
const spaceEnricher = createSpacesRoleEnricher(store);

const syncRouter = createSyncRouter({
  store,
  config,
  roleResolver,
  roleEnricher: spaceEnricher,
  plugins: [
    createProjectionServerPlugin({ store, projections }),
    createSpacesDirectoryServerPlugin({ getString: (k) => store.getString(k), putString: (k, v) => store.put(k, v) }),
    queuing,
  ],
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

// K1: owner-submitted revocation lists (signed by the issuer's root Ed25519 key).
// No cap auth required — the RevocationList signature IS the authentication (acceptList verifies it).
app.post("/revocations", async (c) => {
  let list: unknown;
  try {
    list = await c.req.json();
  } catch {
    return c.json({ ok: false, reason: "invalid JSON" }, 400);
  }
  if (typeof list !== "object" || list === null) {
    return c.json({ ok: false, reason: "body must be a RevocationList object" }, 400);
  }
  const result = revocationStore.acceptList(list as Parameters<typeof revocationStore.acceptList>[0]);
  if (!result.ok) {
    // generation-conflict or signature-invalid — 409 so callers can distinguish from 400.
    const status = result.reason === "too-many-issuers" ? 507 : 409;
    return c.json(result, status);
  }
  return c.json(result, 200);
});

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
