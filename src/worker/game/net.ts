// Socket helpers shared by ZoneRoom and HomeRoom.
import { encode, type ServerMsg } from "../../shared/protocol";

export function send(ws: WebSocket, msg: ServerMsg): void {
  try {
    ws.send(encode(msg));
  } catch {
    // Socket already closing; the close handler cleans up.
  }
}

export function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closed
  }
}

/** Accepts a socket only to close it with an app-level code the client can show (e.g. 4401). */
export function refuseSocket(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

export function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

export const CLOSE_REPLACED = 4000;
export const CLOSE_GUEST = 4401;
export const CLOSE_FORBIDDEN = 4403;
export const CLOSE_LEASE_LOST = 4409;
/** No input for IDLE_TIMEOUT_MS: the client shows "You were idle" and does not auto-reconnect. */
export const CLOSE_IDLE = 4408;
export const IDLE_TIMEOUT_MS = 20 * 60_000;

/** A keep-alive ping frame, which doesn't count as player input. */
export function isPing(message: string): boolean {
  return message.length < 80 && /"t"\s*:\s*"ping"/.test(message);
}
