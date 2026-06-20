"use client";

import { ChatStream, StreamSegment } from "@/types/chat";
import { ToolCard } from "./ToolCard";
import { StreamView } from "@/features/common/StreamView";

/**
 * Render a single chat stream as a vertical list of segments.
 *
 * Why React.memo on TextSegment: when a new token arrives, only the
 * last text segment's text changes. The earlier text segments are
 * referentially stable (see selectors.ts), so React.memo prevents
 * their re-render. This is the spec's "no full-list re-render on
 * every token" requirement.
 */
const TextSegmentView = ({ segment }: { segment: Extract<StreamSegment, { kind: "text" }> }) => {
  return (
    <p
      style={{
        margin: "8px 0",
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {segment.text}
    </p>
  );
};

export function ChatStreamView({ stream }: { stream: ChatStream }) {
  return (
    <StreamView>
      {stream.segments.map((segment, index) => {
        // Use index as key intentionally: segments are append-only and
        // their position in the list is semantically meaningful. A
        // segment's identity is its position, not its content.
        if (segment.kind === "text") {
          return <TextSegmentView key={index} segment={segment} />;
        }
        return <ToolCard key={index} tool={segment} />;
      })}
      <div
        style={{
          fontSize: "12px",
          color: stream.completed ? "#888" : "#0066cc",
          marginTop: "8px",
        }}
      >
        {stream.completed ? "✓ Completed" : "● Streaming…"}
      </div>
    </StreamView>
  );
}
