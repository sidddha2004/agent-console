import { create } from "zustand";
import { ServerMessage } from "@/protocol/messages";
import { TraceEntry } from "@/types/trace";
import { ContextSnapshot } from "@/types/context";

export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected";

interface AgentStore {
  /**
   * The chat view's source of truth: every ordered message that's been
   * rendered to the DOM. Drives the chat panel.
   */
  messages: ServerMessage[];

  /**
   * The trace log: every protocol event (including PING/PONG), keyed
   * by `seq`. Drives the timeline panel.
   */
  trace: Map<number, TraceEntry>;

  /**
   * Context snapshots keyed by `context_id`, each containing an
   * ordered list of snapshots over time. Drives the context
   * inspector. New snapshots are appended; old ones are kept for
   * history scrubbing.
   */
  contexts: Map<string, ContextSnapshot[]>;

  addMessage: (message: ServerMessage) => void;
  addTrace: (message: ServerMessage) => void;
  addContextSnapshot: (snapshot: ContextSnapshot) => void;
  /**
   * Mark a stream as completed by injecting a synthetic STREAM_END
   * into the messages array. Used as a recovery mechanism when the
   * server's STREAM_END was lost (e.g., chaos mode dropped the
   * connection right before STREAM_END was sent) and we want the
   * chat panel to flip "Streaming..." to "Completed".
   *
   * Idempotent: if the stream already has a STREAM_END, do nothing.
   */
  closeStream: (streamId: string) => void;

  lastProcessedSeq: number;
  setLastProcessedSeq: (seq: number) => void;
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  messages: [],
  trace: new Map(),
  contexts: new Map(),
  lastProcessedSeq: 0,
  connectionStatus: "disconnected",

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLastProcessedSeq: (seq) => set({ lastProcessedSeq: seq }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  addTrace: (message) =>
    set((state) => {
      if (state.trace.has(message.seq)) {
        return state;
      }
      const next = new Map(state.trace);
      next.set(message.seq, {
        seq: message.seq,
        receivedAt: Date.now(),
        message,
      });
      return { trace: next };
    }),

  addContextSnapshot: (snapshot) =>
    set((state) => {
      const existing = state.contexts.get(snapshot.contextId) ?? [];
      // Dedupe by seq — chaos replays should not create duplicate history.
      if (existing.some((s) => s.seq === snapshot.seq)) {
        return state;
      }
      const next = new Map(state.contexts);
      next.set(snapshot.contextId, [...existing, snapshot]);
      return { contexts: next };
    }),

  closeStream: (streamId) =>
    set((state) => {
      // Idempotent: if there's already a STREAM_END for this stream, no-op.
      const hasEnd = state.messages.some(
        (m) => m.type === "STREAM_END" && m.stream_id === streamId
      );
      if (hasEnd) return state;
      // Use a synthetic seq well above any real seq to avoid colliding
      // with the buffer's expectations. The selector only cares about
      // (type, stream_id), not seq, so any high value works.
      const synthetic: ServerMessage = {
        type: "STREAM_END",
        seq: Number.MAX_SAFE_INTEGER,
        stream_id: streamId,
      };
      return { messages: [...state.messages, synthetic] };
    }),
}));
