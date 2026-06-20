import { ServerMessage } from "./messages";

/**
 * Parse a raw WebSocket frame into a ServerMessage.
 *
 * Chaos mode can send:
 *  - Malformed JSON (e.g. truncated frame, garbage)
 *  - Valid JSON that doesn't match any of our message shapes
 *  - Messages with missing or wrong-typed fields
 *
 * This function NEVER throws. A corrupt frame is logged and discarded
 * so a single bad message can't take down the whole onmessage handler.
 */
export function parseMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn("[parser] invalid JSON, dropping frame:", err);
    return null;
  }

  if (!isObject(parsed)) {
    console.warn("[parser] non-object frame, dropping:", parsed);
    return null;
  }

  const { type, seq } = parsed as { type?: unknown; seq?: unknown };

  if (typeof type !== "string" || typeof seq !== "number") {
    console.warn("[parser] missing type/seq, dropping:", parsed);
    return null;
  }

  // At this point we trust the shape enough to cast; downstream selectors
  // will tolerate extra/missing optional fields per message type.
  // The double cast (parsed -> unknown -> ServerMessage) is the
  // documented escape hatch for "validated plain object" → "tagged union".
  return parsed as unknown as ServerMessage;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
