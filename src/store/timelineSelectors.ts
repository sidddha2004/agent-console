import { TraceEntry, TimelineRow, TokenBatchRow } from "@/types/trace";
import { ServerMessage, TokenMessage } from "@/protocol/messages";

/**
 * Build a list of timeline rows from the trace log.
 *
 * Algorithm:
 *  1. Iterate trace entries in `seq` order (Map preserves insertion
 *     order, and we only insert each seq once).
 *  2. TOKENs accumulate into a single TokenBatchRow until a non-TOKEN
 *     event arrives, then the batch is flushed and a new one starts.
 *  3. TOOL_CALL/TOOL_RESULT always flush the current batch first,
 *     so tool cards always appear as their own row.
 *  4. Everything else (PING, CONTEXT_SNAPSHOT, STREAM_END, ERROR,
 *     PONG) becomes an EventRow.
 *  5. After the main pass, walk tool_call rows and look up matching
 *     tool_result entries to set `hasResult` for visual linking.
 *
 * Pure function: same input → same output. Memoize at the React layer.
 */
export function buildTimelineRows(trace: Map<number, TraceEntry>): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let currentBatch: TokenBatchRow | null = null;

  for (const entry of trace.values()) {
    const msg = entry.message;
    if (msg.type === "TOKEN") {
      // If the previous batch belongs to a different stream, flush
      // it before starting a new one.
      if (currentBatch && currentBatch.streamId !== msg.stream_id) {
        rows.push(currentBatch);
        currentBatch = null;
      }
      currentBatch = accumulateToken(entry, msg, currentBatch);
    } else {
      // Any non-TOKEN event closes the current batch.
      if (currentBatch) {
        rows.push(currentBatch);
        currentBatch = null;
      }
      const row = eventToRow(entry, msg);
      if (row) rows.push(row);
    }
  }
  // Flush a trailing batch.
  if (currentBatch) {
    rows.push(currentBatch);
    currentBatch = null;
  }

  return linkToolRows(rows, trace);
}

function accumulateToken(
  entry: TraceEntry,
  msg: TokenMessage,
  batch: TokenBatchRow | null
): TokenBatchRow {
  if (batch && batch.streamId === msg.stream_id) {
    // Extend the current batch for this stream.
    return {
      ...batch,
      lastSeq: entry.seq,
      lastReceivedAt: entry.receivedAt,
      count: batch.count + 1,
      text: batch.text + msg.text,
    };
  }
  // Either no batch yet, or the previous batch was for a different
  // stream. The main loop has already flushed the old one before
  // calling us, so we can just start a new batch.
  return {
    kind: "token_batch",
    id: `batch-${entry.seq}`,
    firstSeq: entry.seq,
    lastSeq: entry.seq,
    count: 1,
    firstReceivedAt: entry.receivedAt,
    lastReceivedAt: entry.receivedAt,
    text: msg.text,
    streamId: msg.stream_id,
  };
}

function eventToRow(
  entry: TraceEntry,
  msg: ServerMessage
): TimelineRow | null {
  switch (msg.type) {
    case "TOOL_CALL":
      return {
        kind: "tool_call",
        id: `tc-${msg.call_id}`,
        seq: entry.seq,
        receivedAt: entry.receivedAt,
        callId: msg.call_id,
        toolName: msg.tool_name,
        streamId: msg.stream_id,
        hasResult: false,
      };
    case "TOOL_RESULT":
      return {
        kind: "tool_result",
        id: `tr-${msg.call_id}`,
        seq: entry.seq,
        receivedAt: entry.receivedAt,
        callId: msg.call_id,
        streamId: msg.stream_id,
        result: msg.result,
      };
    case "TOKEN":
      // Handled by accumulateToken; never reached here.
      return null;
    default:
      return {
        kind: "event",
        id: `${msg.type}-${entry.seq}`,
        seq: entry.seq,
        receivedAt: entry.receivedAt,
        message: msg,
      };
  }
}

/**
 * After rows are built, scan the trace for tool_results and mark the
 * matching tool_call row's `hasResult` to true. We mutate the row
 * objects in place because this pass is internal to the selector —
 * the rows are not yet exposed to React.
 */
function linkToolRows(rows: TimelineRow[], trace: Map<number, TraceEntry>): TimelineRow[] {
  const resultCallIds = new Set<string>();
  for (const entry of trace.values()) {
    if (entry.message.type === "TOOL_RESULT") {
      resultCallIds.add(entry.message.call_id);
    }
  }
  return rows.map((row) => {
    if (row.kind === "tool_call" && resultCallIds.has(row.callId)) {
      return { ...row, hasResult: true };
    }
    return row;
  });
}

// ---------- Filtering ----------

export type TimelineFilter = {
  types: Set<TimelineRow["kind"]>;
  query: string;
};

export const ALL_ROW_KINDS: TimelineRow["kind"][] = [
  "token_batch",
  "tool_call",
  "tool_result",
  "event",
];

export function applyFilter(rows: TimelineRow[], filter: TimelineFilter): TimelineRow[] {
  if (filter.types.size === ALL_ROW_KINDS.length && filter.query === "") {
    return rows;
  }
  const q = filter.query.toLowerCase();
  return rows.filter((row) => {
    if (!filter.types.has(row.kind)) return false;
    if (q === "") return true;
    return rowMatchesQuery(row, q);
  });
}

function rowMatchesQuery(row: TimelineRow, q: string): boolean {
  switch (row.kind) {
    case "token_batch":
      return row.text.toLowerCase().includes(q);
    case "tool_call":
      return (
        row.toolName.toLowerCase().includes(q) ||
        row.callId.toLowerCase().includes(q)
      );
    case "tool_result":
      return (
        row.callId.toLowerCase().includes(q) ||
        JSON.stringify(row.result).toLowerCase().includes(q)
      );
    case "event":
      return JSON.stringify(row.message).toLowerCase().includes(q);
  }
}
