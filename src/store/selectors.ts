import { ServerMessage } from "@/protocol/messages";
import { ChatStream, ToolSegment } from "@/types/chat";
import { ConnectionStatus } from "./agentStore";

/**
 * Group ordered messages into per-stream chat models.
 *
 * Algorithm: walk messages in `seq` order. For each stream_id, maintain
 * a list of segments. Tokens append to the LAST text segment of that
 * stream (or open a new one if the last segment is a tool). TOOL_CALL
 * opens a new tool segment. TOOL_RESULT updates the matching tool
 * segment in place (preserves its position in the segment list).
 *
 * The `connectionStatus` parameter lets the selector mark in-flight
 * tools as "stuck" while the connection is down — without mutating
 * the underlying message log.
 *
 * Invariant: a stream's segment list only ever grows. Existing segment
 * references are immutable in the React sense — the selector produces a
 * new array, but segments that don't need to change keep their reference.
 * This is what allows React to skip re-renders for stable text blocks.
 */
export function getStreams(
  messages: ServerMessage[],
  connectionStatus: ConnectionStatus = "connected"
): ChatStream[] {
  const streams = new Map<string, ChatStream>();
  const isOffline =
    connectionStatus === "reconnecting" || connectionStatus === "disconnected";

  for (const message of messages) {
    switch (message.type) {
      case "TOKEN":
        appendToken(streams, message.stream_id, message.text);
        break;
      case "TOOL_CALL":
        openToolSegment(streams, message.stream_id, {
          kind: "tool",
          callId: message.call_id,
          toolName: message.tool_name,
          status: isOffline ? "stuck" : "running",
          args: message.args,
        });
        break;
      case "TOOL_RESULT":
        completeToolSegment(
          streams,
          message.stream_id,
          message.call_id,
          message.result
        );
        break;
      case "STREAM_END":
        closeStream(streams, message.stream_id);
        break;
      default:
        // PING, CONTEXT_SNAPSHOT, ERROR are not part of the chat render.
        break;
    }
  }

  return Array.from(streams.values());
}

function ensureStream(
  streams: Map<string, ChatStream>,
  streamId: string
): ChatStream {
  let stream = streams.get(streamId);
  if (!stream) {
    stream = { streamId, segments: [], completed: false };
    streams.set(streamId, stream);
  }
  return stream;
}

function appendToken(
  streams: Map<string, ChatStream>,
  streamId: string,
  text: string
): void {
  const stream = ensureStream(streams, streamId);
  const last = stream.segments[stream.segments.length - 1];
  if (last && last.kind === "text") {
    // Extend in place by replacing the LAST segment. The earlier text
    // segments keep their reference — React skips re-rendering them.
    stream.segments[stream.segments.length - 1] = {
      kind: "text",
      text: last.text + text,
    };
  } else {
    // Last segment is a tool (or there is no segment). Open a new text
    // segment AFTER the current tail.
    stream.segments.push({ kind: "text", text });
  }
}

function openToolSegment(
  streams: Map<string, ChatStream>,
  streamId: string,
  tool: ToolSegment
): void {
  const stream = ensureStream(streams, streamId);
  stream.segments.push(tool);
}

function completeToolSegment(
  streams: Map<string, ChatStream>,
  streamId: string,
  callId: string,
  result: unknown
): void {
  const stream = streams.get(streamId);
  if (!stream) return;
  const idx = stream.segments.findIndex(
    (s) => s.kind === "tool" && s.callId === callId
  );
  if (idx === -1) return;
  const current = stream.segments[idx] as ToolSegment;
  // Replace the tool segment with an updated copy. The position in the
  // list is preserved, so the card doesn't move on the page.
  stream.segments[idx] = { ...current, status: "completed", result };
}

function closeStream(
  streams: Map<string, ChatStream>,
  streamId: string
): void {
  const stream = streams.get(streamId);
  if (!stream) return;
  stream.completed = true;
}
