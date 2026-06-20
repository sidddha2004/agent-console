import { ServerMessage } from "@/protocol/messages";

/**
 * In-order, deduplicating message buffer.
 *
 * Properties this guarantees:
 *  - Messages are returned in strictly ascending `seq` order, with no gaps.
 *  - Each `seq` is delivered at most once, even if received multiple times
 *    (chaos mode replays / duplicates).
 *  - Calling `prime(nextSeq)` resets internal state so we can resume from
 *    an arbitrary point on a new connection (used after RESUME).
 *
 * Non-properties (important):
 *  - PING messages are NOT meant to go through this buffer. Heartbeats are
 *    control traffic, not renderable content, and their order doesn't
 *    matter for stream rendering.
 */
export class ReorderBuffer {
  private buffer = new Map<number, ServerMessage>();
  private expectedSeq: number;
  private seenSeq = new Set<number>();
  private resyncCount = 0;

  constructor(startSeq: number = 1) {
    this.expectedSeq = startSeq;
  }

  /**
   * Number of times the buffer has resynced (treated a large negative
   * seq gap as a fresh start). Useful for tests and for the socket
   * manager to know when to also reset the store's lastProcessedSeq.
   */
  getResyncCount(): number {
    return this.resyncCount;
  }

  /**
   * Reset the buffer to expect a new minimum sequence. Used on
   * reconnection: after we send RESUME with last_seq=N, we prime this
   * with N+1 so the next drained message is the one immediately
   * after what the DOM already rendered.
   */
  prime(nextSeq: number): void {
    this.expectedSeq = nextSeq;
    this.buffer.clear();
    this.seenSeq.clear();
  }

  insert(message: ServerMessage): void {
    // Drop messages we've already accepted (chaos duplicates / replays).
    if (this.seenSeq.has(message.seq)) {
      return;
    }
    // Drop messages from before our current window — UNLESS the gap
    // is large, in which case our expectedSeq is stale (likely the
    // server was reset / restarted, or its history was cleared) and
    // we need to resync to the new server state. We treat incoming
    // messages with seq < expectedSeq - RESYNC_GAP as a fresh start
    // and re-prime the buffer to the incoming seq.
    //
    // Why 10: chaos mode can introduce small reorder gaps (out-of-
    // order delivery of 2-5 seqs is common), but a gap of 10+ is
    // almost certainly a server reset. The store would otherwise
    // be permanently desynced and never receive tool calls.
    const RESYNC_GAP = 10;
    if (message.seq < this.expectedSeq) {
      if (this.expectedSeq - message.seq > RESYNC_GAP) {
        // The server's seq counter has reset (or our state is
        // desynced). Re-prime the buffer to the incoming seq.
        const oldExpected = this.expectedSeq;
        this.expectedSeq = message.seq;
        this.buffer.clear();
        this.seenSeq.clear();
        this.resyncCount++;
        console.warn(
          `[buffer] seq resync: was expecting ${oldExpected}, got ${message.seq}; resyncing to ${message.seq}`
        );
      } else {
        // Small gap = chaos reorder; drop the message, we already
        // passed this point.
        return;
      }
    }
    this.seenSeq.add(message.seq);
    this.buffer.set(message.seq, message);
  }

  getBufferedMessages(): ServerMessage[] {
    return Array.from(this.buffer.values());
  }

  /**
   * Drain all currently-in-order messages from the front of the buffer.
   * Returns an empty array if the next expected seq isn't buffered yet
   * (caller should wait for more data).
   */
  drainReadyMessages(): ServerMessage[] {
    const ready: ServerMessage[] = [];
    while (this.buffer.has(this.expectedSeq)) {
      const message = this.buffer.get(this.expectedSeq)!;
      ready.push(message);
      this.buffer.delete(this.expectedSeq);
      this.expectedSeq++;
    }
    return ready;
  }

  getExpectedSeq(): number {
    return this.expectedSeq;
  }

  /**
   * Note a seq without inserting the message. Used for PINGs and
   * other control-plane events that bypass the buffer for latency
   * reasons but still consume a seq from the server's counter.
   *
   * Without this, the buffer would get stuck waiting for a PING's
   * seq that never arrives through `insert` (because PINGs return
   * early before the buffer). The chat would silently stop
   * processing, the "Streaming..." indicator would never flip to
   * "Completed", and the trace would keep growing while the
   * messages array stayed frozen.
   *
   * Why not just pass PINGs through the buffer? PINGs have a 3s
   * deadline. If a 30-message backlog is sitting in the buffer
   * ahead of them, the PONG would miss the deadline and the
   * server would treat the client as disconnected.
   *
   * Behaviour:
   *  - If `seq` is the next expected seq (or already past it via
   *    a small gap), advance `expectedSeq` to `seq + 1`.
   *  - If `seq` is in the past (already processed), do nothing.
   *  - If `seq` is way in the past (> RESYNC_GAP), trigger the
   *    same resync logic as `insert`.
   *  - Add the seq to `seenSeq` so a duplicate won't be re-inserted
   *    later by `insert` (and won't trigger the resync path again).
   */
  noteSeq(seq: number): void {
    if (this.seenSeq.has(seq)) return;

    const RESYNC_GAP = 10;
    if (seq < this.expectedSeq) {
      if (this.expectedSeq - seq > RESYNC_GAP) {
        // Server reset; resync.
        const oldExpected = this.expectedSeq;
        this.expectedSeq = seq;
        this.buffer.clear();
        this.seenSeq.clear();
        this.resyncCount++;
        console.warn(
          `[buffer] seq resync (via noteSeq): was expecting ${oldExpected}, got ${seq}; resyncing to ${seq}`
        );
        this.seenSeq.add(seq);
        this.expectedSeq = seq + 1;
      } else {
        // Already past this point; just mark it seen so insert()
        // doesn't trip over it.
        this.seenSeq.add(seq);
      }
      return;
    }

    // seq >= expectedSeq: advance expectedSeq past it.
    this.seenSeq.add(seq);
    this.expectedSeq = seq + 1;
  }
}
