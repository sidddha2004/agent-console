"use client";

import { useEffect, useMemo, useState } from "react";
import { useAgentStore } from "@/store/agentStore";
import { getStreams } from "@/store/selectors";
import { socket } from "@/websocket/socket";
import { ChatStreamView } from "@/features/chat/ChatStreamView";
import { Timeline } from "@/features/timeline/Timeline";
import { ContextInspector } from "@/features/context/ContextInspector";

type SidePanel = "timeline" | "context" | null;

export default function Home() {
  const [input, setInput] = useState("");
  const messages = useAgentStore((state) => state.messages);
  const connectionStatus = useAgentStore((state) => state.connectionStatus);
  const closeStream = useAgentStore((s) => s.closeStream);
  const [sidePanel, setSidePanel] = useState<SidePanel>("timeline");

  const streams = useMemo(
    () => getStreams(messages, connectionStatus),
    [messages, connectionStatus]
  );

  useEffect(() => {
    socket.connect();
  }, []);

  // Recovery: if a connection drop happened mid-stream (chaos mode can
  // drop the connection right before STREAM_END is sent), the STREAM_END
  // is lost and the chat panel will forever show "Streaming...". To
  // handle this, schedule a timer on every reconnect: if after the
  // connection comes back, any in-progress stream still has no STREAM_END
  // after a short delay, synthesize one for it.
  //
  // Why a delay: we don't want to fire this immediately on reconnect
  // because the server may be replaying events that include the
  // STREAM_END. We give it a few seconds to arrive, then close any
  // streams that are still open.
  useEffect(() => {
    if (connectionStatus !== "connected") return;
    const handle = setTimeout(() => {
      // Find streams that have tokens/tools but no STREAM_END.
      const streamsSeen = new Set<string>();
      const streamsWithEnd = new Set<string>();
      for (const m of messages) {
        if (m.type === "STREAM_END") streamsWithEnd.add(m.stream_id);
        if (
          m.type === "TOKEN" ||
          m.type === "TOOL_CALL" ||
          m.type === "TOOL_RESULT"
        ) {
          streamsSeen.add(m.stream_id);
        }
      }
      for (const streamId of streamsSeen) {
        if (!streamsWithEnd.has(streamId)) {
          console.warn(
            `[recovery] stream ${streamId} never received STREAM_END; closing it`
          );
          closeStream(streamId);
        }
      }
    }, 3000);
    return () => clearTimeout(handle);
  }, [connectionStatus, messages, closeStream]);

  // Listen for chat:highlight from the timeline (a timeline row was
  // clicked) and scroll the matching chat element into view.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ rowId: string }>).detail;
      if (!detail.rowId.startsWith("tc-")) return;
      const cardId = detail.rowId;
      const el = document.querySelector(`[data-card-id="${cardId}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        (el as HTMLElement).style.outline = "2px solid #0066cc";
        setTimeout(() => {
          (el as HTMLElement).style.outline = "";
        }, 1500);
      }
    };
    window.addEventListener("chat:highlight", handler);
    return () => window.removeEventListener("chat:highlight", handler);
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui" }}>
      <header style={{ padding: "12px 16px", borderBottom: "1px solid #ccc" }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Agent Console</h1>
        <ConnectionBadge status={connectionStatus} />
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <main
          style={{
            flex: 1,
            padding: 16,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              style={{ flex: 1, padding: 8, fontSize: 14 }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim()) {
                  socket.sendUserMessage(input);
                  setInput("");
                }
              }}
            />
            <button
              onClick={() => {
                if (input.trim()) {
                  socket.sendUserMessage(input);
                  setInput("");
                }
              }}
              style={{ padding: "8px 16px" }}
            >
              Send
            </button>
            <button
              onClick={() => setSidePanel((p) => (p === "timeline" ? null : "timeline"))}
              style={{
                padding: "8px 12px",
                background: sidePanel === "timeline" ? "#0066cc" : "#fff",
                color: sidePanel === "timeline" ? "#fff" : "#333",
              }}
              title="Toggle timeline"
            >
              Timeline
            </button>
            <button
              onClick={() => setSidePanel((p) => (p === "context" ? null : "context"))}
              style={{
                padding: "8px 12px",
                background: sidePanel === "context" ? "#0066cc" : "#fff",
                color: sidePanel === "context" ? "#fff" : "#333",
              }}
              title="Toggle context inspector"
            >
              Context
            </button>
          </div>

          <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
            Messages received: {messages.length} · Streams: {streams.length} ·{" "}
            {messages.filter((m) => m.type === "TOOL_CALL").length} tool calls,{" "}
            {messages.filter((m) => m.type === "TOOL_RESULT").length} results,{" "}
            {messages.filter((m) => m.type === "TOKEN").length} tokens
          </div>

          <div style={{ flex: 1 }}>
            {streams.length === 0 && (
              <div style={{ color: "#999", fontSize: 13 }}>
                <p>No streams yet. Send a message to start.</p>
                <p style={{ fontSize: 11, marginTop: 8 }}>
                  Try: &ldquo;hello&rdquo; (no tools), &ldquo;summarise the q3
                  report&rdquo; (1 tool), &ldquo;analyze the market&rdquo; (2
                  tools), or &ldquo;lookup deployment SLA&rdquo; (tool before
                  tokens).
                </p>
              </div>
            )}
            {streams.map((stream) => (
              <ChatStreamView key={stream.streamId} stream={stream} />
            ))}
          </div>
        </main>

        {sidePanel !== null && (
          <aside
            style={{
              width: 420,
              borderLeft: "1px solid #ccc",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {sidePanel === "timeline" && <Timeline />}
            {sidePanel === "context" && <ContextInspector />}
          </aside>
        )}
      </div>
    </div>
  );
}

function ConnectionBadge({ status }: { status: ReturnType<typeof useAgentStore.getState>["connectionStatus"] }) {
  const colors: Record<typeof status, { bg: string; label: string }> = {
    connected: { bg: "#e6ffe6", label: "Connected" },
    connecting: { bg: "#fff7e6", label: "Connecting…" },
    reconnecting: { bg: "#ffe6e6", label: "Reconnecting…" },
    disconnected: { bg: "#ffe6e6", label: "Disconnected" },
  };
  const { bg, label } = colors[status];
  return (
    <span
      style={{
        padding: "2px 8px",
        marginLeft: 8,
        background: bg,
        border: "1px solid #ccc",
        borderRadius: 4,
        fontSize: 12,
        display: "inline-block",
      }}
    >
      {label}
    </span>
  );
}
