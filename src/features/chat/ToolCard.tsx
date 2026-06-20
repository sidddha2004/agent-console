"use client";

import { ToolSegment } from "@/types/chat";

const STATUS_COLORS: Record<ToolSegment["status"], { bg: string; label: string }> = {
  pending: { bg: "#fff7e6", label: "Pending" },
  running: { bg: "#fff7e6", label: "Running" },
  completed: { bg: "#e6ffe6", label: "Completed" },
  stuck: { bg: "#ffe6e6", label: "Waiting (reconnecting)" },
};

export function ToolCard({ tool }: { tool: ToolSegment }) {
  const style = STATUS_COLORS[tool.status];
  return (
    <div
      data-card-id={`tc-${tool.callId}`}
      style={{
        border: "1px solid orange",
        background: style.bg,
        padding: "8px 12px",
        marginTop: "8px",
        marginLeft: "16px",
        borderRadius: "4px",
        fontSize: "14px",
        // CRITICAL: min-height prevents the card from collapsing/reflowing
        // when status changes from "Running" to "Completed".
        minHeight: "60px",
        // Bidirectional link target.
        cursor: "pointer",
      }}
      onClick={() => {
        // Notify the timeline panel to scroll to and highlight
        // the matching TOOL_CALL row.
        window.dispatchEvent(
          new CustomEvent("timeline:highlight", {
            detail: { rowId: `tc-${tool.callId}` },
          })
        );
      }}
    >
      <div style={{ fontWeight: 600 }}>
        🔧 {tool.toolName}{" "}
        <span style={{ fontWeight: 400, color: "#555" }}>— {style.label}</span>
      </div>
      {tool.args !== undefined && (
        <details style={{ marginTop: "4px" }}>
          <summary style={{ cursor: "pointer", color: "#666" }}>args</summary>
          <pre style={{ fontSize: "12px", margin: "4px 0" }}>
            {JSON.stringify(tool.args, null, 2)}
          </pre>
        </details>
      )}
      {tool.result !== undefined && (
        <details style={{ marginTop: "4px" }}>
          <summary style={{ cursor: "pointer", color: "#666" }}>result</summary>
          <pre style={{ fontSize: "12px", margin: "4px 0" }}>
            {JSON.stringify(tool.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
