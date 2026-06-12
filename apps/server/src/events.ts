/**
 * Authenticated SSE proxy — gates the Whistlers space-change stream behind
 * cap-cert auth and per-space membership validation.
 *
 * Auth: verifies cap-cert + per-request Ed25519 signature (no scope.paths
 * enforcement — /events is a meta-endpoint; access is controlled by the
 * per-space membership check below).
 *
 * Filter: client declares candidate spaceIds via ?spaces=sp-a,sp-b. Each is
 * validated against `spaces/{id}/_rooms` membership (makeSpaceRoleEnricher).
 * The authorized ids map to sanitized Whistlers destinationTopics derived from
 * `octospaces.space.changed.<spaceId>` — the same transform queue.ts applies
 * when publishing to NATS.
 *
 * ★ Firehose-prevention invariant: the upstream Whistlers URL ALWAYS carries at
 * least one ?topic= param. An empty authorized set substitutes the sentinel
 * "__none__" so Whistlers never streams the global firehose.
 */
import { Hono, type Context } from "hono";
import {
  verifyCapCert,
  verifyRequestSignature,
  isWithinClockSkew,
  getBase64,
  type CapCert,
} from "@drakkar.software/starfish-protocol";
import type {
  NonceCache,
  RevocationStore,
  RoleEnricher,
} from "@drakkar.software/starfish-server";

import { SPACE_MEMBER_ROLE } from "./space-role.js";

const WHISTLERS_INTERNAL_URL =
  process.env.WHISTLERS_INTERNAL_URL ?? "http://localhost:8080/events";

const sanitizeTopic = (t: string) => t.replace(/[^a-zA-Z0-9\-_~%]/g, "-");
const WHISTLERS_NAMESPACE = "octospaces";

function parseCapHeader(authHeader: string): CapCert | null {
  if (!authHeader.startsWith("Cap ")) return null;
  const b64 = authHeader.slice("Cap ".length).trim();
  if (!b64) return null;
  try {
    const json = new TextDecoder().decode(getBase64().decode(b64));
    return JSON.parse(json) as CapCert;
  } catch {
    return null;
  }
}

async function authenticateEventsRequest(
  c: Context,
  opts: { nonceCache: NonceCache; revocationStore: RevocationStore },
): Promise<string | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) return null;
  const cert = parseCapHeader(authHeader);
  if (!cert) return null;

  const sigB64 = c.req.header("X-Starfish-Sig");
  const tsStr = c.req.header("X-Starfish-Ts");
  const nonce = c.req.header("X-Starfish-Nonce");
  if (!sigB64 || !tsStr || !nonce) return null;

  const tsNum = Number(tsStr);
  if (!Number.isFinite(tsNum) || !isWithinClockSkew(tsNum, Date.now())) return null;

  const certResult = await verifyCapCert(cert, { now: Math.floor(Date.now() / 1000) });
  if (!certResult.ok) return null;

  if (!cert.sub) return null;

  let pathAndQuery: string;
  let host: string;
  try {
    const u = new URL(c.req.url);
    pathAndQuery = u.pathname + u.search;
    host = u.host;
  } catch {
    pathAndQuery = c.req.url;
    host = "";
  }

  const sigOk = await verifyRequestSignature(
    { method: "GET", pathAndQuery, host },
    { sig: sigB64, ts: tsNum, nonce },
    cert.sub,
  );
  if (!sigOk) return null;

  if (!opts.nonceCache.checkAndRemember(cert.sub, nonce, Date.now())) return null;
  if (opts.revocationStore.isRevoked(cert.iss, cert.sub, cert.nonce)) return null;

  if (cert.kind === "device") return cert.issUserId;
  if (cert.kind === "member" && cert.subUserId) return cert.subUserId;
  return null;
}

export interface EventsRouteOptions {
  enricher: RoleEnricher;
  nonceCache: NonceCache;
  revocationStore: RevocationStore;
}

export function createEventsRoute(opts: EventsRouteOptions): Hono {
  const { enricher, nonceCache, revocationStore } = opts;
  const app = new Hono();

  app.get("/events", async (c) => {
    const identity = await authenticateEventsRequest(c, { nonceCache, revocationStore });
    if (!identity) return c.json({ error: "unauthorized" }, 401);

    const spacesParam = c.req.query("spaces") ?? "";
    const candidates = spacesParam.split(",").map((s) => s.trim()).filter(Boolean);

    const authorized: string[] = [];
    for (const spaceId of candidates) {
      const roles = await enricher({ identity, roles: [] }, { spaceId });
      if (roles.includes(SPACE_MEMBER_ROLE)) authorized.push(spaceId);
    }

    const topics = authorized.map(
      (s) => `${WHISTLERS_NAMESPACE}-${sanitizeTopic(`octospaces.space.changed.${s}`)}`,
    );
    const safeTopics = topics.length > 0 ? topics : ["__none__"];

    const qs = safeTopics.map((t) => `topic=${encodeURIComponent(t)}`).join("&");
    const upstreamUrl = `${WHISTLERS_INTERNAL_URL}?${qs}`;

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: { Accept: "text/event-stream" },
        signal: c.req.raw.signal,
      });
    } catch {
      return c.json({ error: "upstream unavailable" }, 503);
    }

    if (!upstream.ok || !upstream.body) {
      return c.json({ error: "upstream error" }, 502);
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
