"use client";

import { memo } from "react";
import { TimelineRow as Row } from "@/types/trace";
import {
  ContextSnapshotMessage,
  ErrorMessage,
  ServerMessage,
  StreamEndMessage,
} from "@/protocol/messages";

interface Props {
  row: Row;
  highlighted: boolean;
  onClick: (row: Row) => void;
}

const ROW_COLOR: Record<Row["kind"], string> = {
  token_batch: "#0066cc",
  tool_call: "#cc6600",
  tool_result: "#009933",
  event: "#555",
};

function seqTitle(row: Row): string {
  if (row.kind === "token_batch") return `seq ${row.firstSeq}–${row.lastSeq}`;
  return `seq ${row.seq}`;
}

/**
 * One timeline row. Memoized so a token-batched update doesn't
 * re-render every other row.
 *
 * The "highlighted" state is purely visual; we don't move focus or
 * trigger a scroll here. The parent decides what "highlight" means
 * (e.g. flashing a border, or a CSS class). Keeping it dumb means we
 * can reuse the row component for the bidirectional link target.
 */
function TimelineRowImpl({ row, highlighted, onClick }: Props) {
  const baseStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderLeft: `3px solid ${ROW_COLOR[row.kind]}`,
    background: highlighted ? "#fff7e6" : "transparent",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "ui-monospace, monospace",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  return (
    <div
      data-row-id={row.id}
      data-row-kind={row.kind}
      onClick={() => onClick(row)}
      style={baseStyle}
      title={seqTitle(row)}
    >
      {row.kind === "token_batch" && <TokenBatchContent row={row} />}
      {row.kind === "tool_call" && <ToolCallContent row={row} />}
      {row.kind === "tool_result" && <ToolResultContent row={row} />}
      {row.kind === "event" && <EventContent row={row} />}
    </div>
  );
}

export const TimelineRow = memo(TimelineRowImpl);

function ageString(receivedAt: number): string {
  const ms = Date.now() - receivedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function TokenBatchContent({ row }: { row: Extract<Row, { kind: "token_batch" }> }) {
  const duration = row.lastReceivedAt - row.firstReceivedAt;
  return (
    <span>
      <strong style={{ color: ROW_COLOR.token_batch }}>TOKEN</strong>{" "}
      seq {row.firstSeq}–{row.lastSeq} · Streamed {row.count} token
      {row.count === 1 ? "" : "s"} ({duration}ms){" "}
      <span style={{ color: "#888" }}>{ageString(row.lastReceivedAt)} ago</span>
    </span>
  );
}

function ToolCallContent({ row }: { row: Extract<Row, { kind: "tool_call" }> }) {
  return (
    <span>
      <strong style={{ color: ROW_COLOR.tool_call }}>TOOL_CALL</strong>{" "}
      seq {row.seq} · {row.toolName} ({row.callId}){" "}
      {row.hasResult ? (
        <span style={{ color: "#009933" }}>✓ linked</span>
      ) : (
        <span style={{ color: "#cc0000" }}>… awaiting result</span>
      )}{" "}
      <span style={{ color: "#888" }}>{ageString(row.receivedAt)} ago</span>
    </span>
  );
}

function ToolResultContent({ row }: { row: Extract<Row, { kind: "tool_result" }> }) {
  return (
    <span>
      <strong style={{ color: ROW_COLOR.tool_result }}>TOOL_RESULT</strong>{" "}
      seq {row.seq} · {row.callId} · result:{" "}
      <code style={{ color: "#555" }}>
        {JSON.stringify(row.result).slice(0, 60)}
        {JSON.stringify(row.result).length > 60 ? "…" : ""}
      </code>{" "}
      <span style={{ color: "#888" }}>{ageString(row.receivedAt)} ago</span>
    </span>
  );
}

function EventContent({ row }: { row: Extract<Row, { kind: "event" }> }) {
  const summary = summariseEvent(row.message);
  return (
    <span>
      <strong style={{ color: ROW_COLOR.event }}>{row.message.type}</strong>{" "}
      seq {row.seq} · {summary}{" "}
      <span style={{ color: "#888" }}>{ageString(row.receivedAt)} ago</span>
    </span>
  );
}

function summariseEvent(msg: ServerMessage): string {
  switch (msg.type) {
    case "PING":
      return `challenge="${msg.challenge}"`;
    case "CONTEXT_SNAPSHOT": {
      const m = msg as ContextSnapshotMessage;
      return `context_id=${m.context_id}, keys=${Object.keys(m.data).length}`;
    }
    case "STREAM_END": {
      const m = msg as StreamEndMessage;
      return `stream_id=${m.stream_id}`;
    }
    case "ERROR": {
      const m = msg as ErrorMessage;
      return `${m.code}: ${m.message}`;
    }
    default:
      return JSON.stringify(msg).slice(0, 60);
  }
}
