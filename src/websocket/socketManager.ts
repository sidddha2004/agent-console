import { parseMessage } from "@/protocol/parser";
import { useAgentStore } from "@/store/agentStore";
import { ReorderBuffer } from "@/utils/reorderBuffer";
import { ServerMessage } from "@/protocol/messages";

/**
 * Owns the WebSocket lifecycle and the in-order message pipeline.
 *
 * Message flow:
 *   1. raw frame -> parseMessage() (validates, never throws)
 *   2. PING     -> respond with PONG immediately, do NOT buffer
 *                  (heartbeat liveness doesn't depend on seq order)
 *   3. else     -> ReorderBuffer (dedup, in-order, gap-immune)
 *   4. drained  -> addMessage to store, then send TOOL_ACK if applicable
 *                  (ACK only after the card has been rendered)
 *   5. update lastProcessedSeq -> used by RESUME on reconnect
 */
export class SocketManager {
  private socket: WebSocket | null = null;
  private reorderBuffer = new ReorderBuffer();
  private reconnectDelay = 500;

  connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    console.log("[socket] creating WebSocket...");
    useAgentStore.getState().setConnectionStatus("connecting");

    this.socket = new WebSocket("ws://localhost:4747/ws");

    this.socket.onopen = () => {
      console.log("[socket] open");
      useAgentStore.getState().setConnectionStatus("connected");
      this.reconnectDelay = 500;

      // As the FIRST message on a new connection, ask the server to
      // replay anything we missed. If lastProcessedSeq is 0, this is
      // effectively a no-op (server replays from the beginning, but
      // nothing was missed because we've never connected before).
      this.sendResume();
    };

    this.socket.onclose = (event) => {
      console.log("[socket] close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.socket = null;
      useAgentStore.getState().setConnectionStatus("disconnected");
      this.scheduleReconnect();
    };

    this.socket.onerror = (error) => {
      // onerror fires just before onclose for most failures; we don't
      // reconnect here, onclose handles that.
      console.error("[socket] error", error);
    };

    this.socket.onmessage = (event) => {
      const message = parseMessage(event.data);
      if (message === null) {
        // Parser already logged; drop the bad frame and keep going.
        return;
      }

      // Every received event goes into the trace log — including PINGs
      // and out-of-order arrivals. The trace is the "what the wire
      // actually delivered" record; the chat is the "what we've
      // rendered" record. They are different by design.
      useAgentStore.getState().addTrace(message);

      // CONTEXT_SNAPSHOTs are captured here (before the reorder
      // pipeline) so the context inspector sees them in the order
      // they arrived on the wire. The inspector doesn't depend on
      // seq ordering for correctness — only for displaying the
      // timestamp, which is captured at receive time.
      if (message.type === "CONTEXT_SNAPSHOT") {
        useAgentStore.getState().addContextSnapshot({
          contextId: message.context_id,
          seq: message.seq,
          receivedAt: Date.now(),
          data: message.data,
        });
        // We still need to pass it through the reorder buffer so the
        // chat pipeline records it (if it ever cares) and updates
        // lastProcessedSeq. Don't return early.
      }

      // PINGs are control traffic, NOT renderable content. Handle them
      // outside the reorder pipeline so a 3s heartbeat deadline is
      // never blocked by an out-of-order data message.
      //
      // BUT we still need to acknowledge the PING's seq to the
      // reorder buffer, otherwise the buffer's expectedSeq would
      // never advance past the PING's slot and the next data
      // message (with seq > PING's seq) would get stuck waiting
      // for the PING's seq to appear in the buffer.
      if (message.type === "PING") {
        this.reorderBuffer.noteSeq(message.seq);
        this.sendPong(message.challenge);
        return;
      }

      // Everything else goes through the reorder buffer.
      const resyncsBefore = this.reorderBuffer.getResyncCount();
      this.reorderBuffer.insert(message);

      const ready = this.reorderBuffer.drainReadyMessages();
      if (ready.length > 0) {
        console.log(
          `[buffer] drained ${ready.length}, expected next = ${this.reorderBuffer.getExpectedSeq()}`
        );
      }

      // If a resync happened during insert (large negative seq gap),
      // the store's lastProcessedSeq is also stale — future RESUMEs
      // would lie to the server. Reset it to the most recent drained
      // seq, which the buffer has just confirmed is in-order.
      if (this.reorderBuffer.getResyncCount() > resyncsBefore && ready.length > 0) {
        const lastDrained = ready[ready.length - 1]!;
        useAgentStore.getState().setLastProcessedSeq(lastDrained.seq);
      }

      for (const m of ready) {
        console.log(
          `[process] seq=${m.seq} type=${m.type}${
            m.type === "TOOL_CALL" ? ` call_id=${m.call_id} tool=${m.tool_name}` : ""
          }`
        );
        this.processOrdered(m);
      }
    };
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendUserMessage(content: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.log("[socket] not open, dropping USER_MESSAGE");
      return;
    }
    this.socket.send(JSON.stringify({ type: "USER_MESSAGE", content }));
  }

  /**
   * Process a message that has been confirmed in-order by the buffer.
   * Updates the store, then sends any protocol-level acknowledgement
   * that should follow rendering.
   */
  private processOrdered(message: ServerMessage): void {
    const store = useAgentStore.getState();

    // Add to store FIRST so the React tree renders the card. After
    // this, any TOOL_ACK we send reflects a tool card the user can
    // actually see.
    store.addMessage(message);
    store.setLastProcessedSeq(message.seq);

    if (message.type === "TOOL_CALL") {
      this.sendToolAck(message.call_id);
    }
  }

  private sendPong(challenge: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    // Spec: echo the challenge verbatim, even if it's empty (chaos).
    this.socket.send(JSON.stringify({ type: "PONG", echo: challenge }));
  }

  private sendToolAck(callId: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn(`[socket] could not send TOOL_ACK for ${callId}: socket not open`);
      return;
    }
    this.socket.send(JSON.stringify({ type: "TOOL_ACK", call_id: callId }));
    console.log(`[socket] TOOL_ACK sent for ${callId}`);
  }

  private sendResume(): void {
    const lastSeq = useAgentStore.getState().lastProcessedSeq;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    // Prime the buffer BEFORE the server's replay arrives, so the
    // first replayed message (lastSeq + 1) is accepted and the buffer
    // doesn't sit waiting for old sequences we'll never see again.
    this.reorderBuffer.prime(lastSeq + 1);

    this.socket.send(JSON.stringify({ type: "RESUME", last_seq: lastSeq }));
    console.log("[socket] RESUME sent, last_seq =", lastSeq);
  }

  private scheduleReconnect(): void {
    useAgentStore.getState().setConnectionStatus("reconnecting");
    console.log(`[socket] reconnecting in ${this.reconnectDelay}ms`);

    setTimeout(() => {
      // Only reconnect if we're still in a disconnected/reconnecting
      // state. (Avoids racing with a manual close.)
      const status = useAgentStore.getState().connectionStatus;
      if (status === "reconnecting" || status === "disconnected") {
        this.connect();
      }
    }, this.reconnectDelay);

    // Exponential backoff: 500, 1000, 2000, 4000, 8000, 10000 (capped).
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
  }
}
