import { ServerMessage } from "@/protocol/messages";

/**
 * A trace entry is one protocol event, captured with a server timestamp
 * for the timeline's "ms ago" display.
 *
 * Why a separate `TraceEntry` and not just `ServerMessage`:
 *  - The store of truth for the trace is a Map keyed by `seq`. We need
 *    a stable object identity per event, regardless of how the view
 *    groups them.
 *  - The view groups consecutive TOKENs into TokenBatch rows; the
 *    trace keeps each token separately so we can show counts, timing,
 *    and full text on expand.
 *  - PING/PONG heartbeats ARE stored (the spec requires them in the
 *    timeline) but they don't drive any other state.
 */
export interface TraceEntry {
  seq: number;
  receivedAt: number; // Date.now() when the message entered the store
  message: ServerMessage;
}

/**
 * View-model rows for the timeline. These are derived from the trace
 * log by the timeline selector. Storing them in a separate type makes
 * it clear that the view is a projection, not the source of truth.
 */
export type TimelineRow =
  | TokenBatchRow
  | ToolCallRow
  | ToolResultRow
  | EventRow;

export interface TokenBatchRow {
  kind: "token_batch";
  id: string; // stable id for React keys; e.g. "batch-{firstSeq}"
  firstSeq: number;
  lastSeq: number;
  count: number;
  firstReceivedAt: number;
  lastReceivedAt: number;
  text: string;
  streamId: string;
}

export interface ToolCallRow {
  kind: "tool_call";
  id: string; // "tc-{callId}"
  seq: number;
  receivedAt: number;
  callId: string;
  toolName: string;
  streamId: string;
  hasResult: boolean; // updated when a matching TOOL_RESULT is added
}

export interface ToolResultRow {
  kind: "tool_result";
  id: string; // "tr-{callId}"
  seq: number;
  receivedAt: number;
  callId: string;
  streamId: string;
  result: unknown;
}

export interface EventRow {
  kind: "event";
  id: string; // "{type}-{seq}"
  seq: number;
  receivedAt: number;
  message: ServerMessage; // CONTEXT_SNAPSHOT, STREAM_END, ERROR, PING, PONG
}
