import { connect, type NatsConnection } from "@nats-io/transport-node";
import { CustomQueue, type Queue } from "@drakkar.software/starfish-queuing";

/**
 * NATS transport for the Starfish queuing plugin. Wraps the `nats` client in a
 * `CustomQueue` whose `onPublish` forwards each change-event to NATS. Whistlers
 * subscribes to NATS and re-serves the events as SSE.
 *
 * When `NATS_URL` is unset (local dev without docker-compose), returns a no-op
 * queue so the server still boots — change-events simply aren't published.
 */
export async function createNatsQueue(): Promise<{ queue: Queue; nc: NatsConnection | null }> {
  const url = process.env.NATS_URL;
  if (!url) {
    console.warn("[OctoSpaces] NATS_URL unset — space change-events are not published (dev).");
    return { queue: new CustomQueue({ onPublish: () => {} }), nc: null };
  }
  const nc = await connect({ servers: url, name: "octospaces-server" });
  console.log(`[OctoSpaces] Publishing space change-events to NATS at ${url}`);
  const queue = new CustomQueue({
    onPublish: (subject, payload) => {
      let spaceId: string | undefined;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          params?: { spaceId?: string };
        };
        spaceId = msg.params?.spaceId;
      } catch {
        /* fall through */
      }
      nc.publish(spaceId ? `${subject}.${spaceId}` : subject, payload);
    },
  });
  return { queue, nc };
}
