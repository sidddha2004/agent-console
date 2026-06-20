import { describe, it, expect } from "vitest";
import { ReorderBuffer } from "./reorderBuffer";
import { ServerMessage } from "@/protocol/messages";

/** Build a minimal TOKEN message — we only care about `seq` for ordering tests. */
const token = (seq: number, text: string = "x"): ServerMessage => ({
  type: "TOKEN",
  seq,
  text,
  stream_id: "s1",
});

describe("ReorderBuffer", () => {
  it("returns nothing for an empty buffer", () => {
    const buf = new ReorderBuffer();
    expect(buf.drainReadyMessages()).toEqual([]);
  });

  it("returns a single in-order message", () => {
    const buf = new ReorderBuffer();
    buf.insert(token(1, "a"));
    const out = buf.drainReadyMessages();
    expect(out).toHaveLength(1);
    expect(out[0].seq).toBe(1);
    // After draining, second drain should be empty.
    expect(buf.drainReadyMessages()).toEqual([]);
  });

  it("reorders a fully reversed sequence", () => {
    const buf = new ReorderBuffer();
    // Insert 5,4,3,2,1 in that order.
    for (const seq of [5, 4, 3, 2, 1]) {
      buf.insert(token(seq, `t${seq}`));
    }
    const out = buf.drainReadyMessages();
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("drains incrementally as gaps fill", () => {
    const buf = new ReorderBuffer();
    buf.insert(token(1));
    expect(buf.drainReadyMessages()).toHaveLength(1); // drains 1

    buf.insert(token(3));
    expect(buf.drainReadyMessages()).toHaveLength(0); // 2 missing, blocked

    buf.insert(token(2));
    // Once 2 is inserted, 2 AND 3 are both in-order, so both drain.
    expect(buf.drainReadyMessages().map((m) => m.seq)).toEqual([2, 3]);
  });

  it("drops late-arriving messages below the current expected seq", () => {
    // After draining [1], expectedSeq=2. If seq=2 arrives late (chaos
    // reorder), the buffer should drop it because the DOM has already
    // moved past 1 and there's nothing to "deliver into".
    const buf = new ReorderBuffer();
    buf.insert(token(1));
    buf.insert(token(3));
    buf.drainReadyMessages(); // drains [1]; expectedSeq=2 (2 is missing, 3 stays in buffer)
    buf.insert(token(2, "late"));
    const out = buf.drainReadyMessages();
    // Now 2 and 3 are both in-order, so both drain.
    expect(out.map((m) => m.seq)).toEqual([2, 3]);
  });

  it("truly drops messages already below window after a prime", () => {
    // A reconnect path: after RESUME with last_seq=20, a stray seq=15
    // arriving over the new connection must NOT be rendered.
    const buf = new ReorderBuffer();
    buf.prime(21);
    buf.insert(token(15, "stale"));
    expect(buf.drainReadyMessages()).toEqual([]);
  });

  it("deduplicates a message inserted twice", () => {
    const buf = new ReorderBuffer();
    buf.insert(token(1, "first"));
    buf.insert(token(1, "duplicate")); // chaos duplicate
    const out = buf.drainReadyMessages();
    expect(out).toHaveLength(1);
    expect((out[0] as { text: string }).text).toBe("first");
  });

  it("deduplicates a duplicate that arrives after drain", () => {
    // Server replays seq=1 after we've already processed it. Common in
    // RESUME scenarios where the boundary is ambiguous.
    const buf = new ReorderBuffer();
    buf.insert(token(1));
    expect(buf.drainReadyMessages()).toHaveLength(1);

    buf.insert(token(1, "replayed"));
    expect(buf.drainReadyMessages()).toEqual([]); // dedup
  });

  it("prime() resets the buffer to a new starting sequence", () => {
    const buf = new ReorderBuffer();
    buf.insert(token(1));
    buf.insert(token(2));
    buf.drainReadyMessages(); // expect 1, then 2; expectedSeq now 3

    // Reconnect: server will replay from 10 onwards.
    buf.prime(10);
    expect(buf.drainReadyMessages()).toEqual([]); // nothing buffered

    buf.insert(token(10));
    buf.insert(token(11));
    const out = buf.drainReadyMessages();
    expect(out.map((m) => m.seq)).toEqual([10, 11]);
  });

  it("drops messages with seq below the primed window", () => {
    // After RESUME with last_seq=20, a stray seq=15 must NOT be rendered
    // (it was already rendered before the drop).
    const buf = new ReorderBuffer();
    buf.prime(21);
    buf.insert(token(15, "stale"));
    expect(buf.drainReadyMessages()).toEqual([]);
  });

  it("supports a non-default starting sequence in the constructor", () => {
    // Useful if the server signals a starting seq in a hello/handshake.
    const buf = new ReorderBuffer(100);
    buf.insert(token(100));
    expect(buf.drainReadyMessages().map((m) => m.seq)).toEqual([100]);
  });

  it("resyncs when the server's seq counter has reset (large negative gap)", () => {
    // Simulate: client processed up to seq=200, then the server was
    // reset and started a new conversation from seq=1. The client
    // is "ahead" of the server.
    const buf = new ReorderBuffer(201);
    buf.insert(token(1, "fresh"));
    // Without resync: 1 < 201, dropped. With resync: large gap (200),
    // buffer re-primes to 1 and accepts.
    const out = buf.drainReadyMessages();
    expect(out.map((m) => m.seq)).toEqual([1]);
  });

  it("does not resync on small seq gaps (chaos reorder)", () => {
    // Gap of 5 < RESYNC_GAP (10), so it should be dropped, not resync.
    const buf = new ReorderBuffer(15);
    buf.insert(token(10));
    expect(buf.drainReadyMessages()).toEqual([]);
  });

  it("resyncs at the threshold boundary", () => {
    // Gap of exactly 11 > RESYNC_GAP, should resync.
    const buf = new ReorderBuffer(20);
    expect(buf.getResyncCount()).toBe(0);
    buf.insert(token(9, "fresh"));
    expect(buf.getResyncCount()).toBe(1);
    const out = buf.drainReadyMessages();
    expect(out.map((m) => m.seq)).toEqual([9]);
  });

  it("noteSeq advances expectedSeq past PINGs without inserting them", () => {
    // Simulate: server sends seq=1 (TOKEN), seq=2 (PING), seq=3 (TOKEN).
    // The PING bypasses the buffer (we call noteSeq for it), but the
    // buffer must still expect seq=3 after seq=1.
    const buf = new ReorderBuffer();
    buf.insert(token(1, "hello"));
    expect(buf.drainReadyMessages().map((m) => m.seq)).toEqual([1]);
    expect(buf.getExpectedSeq()).toBe(2);

    // PING arrives; we call noteSeq but don't insert.
    buf.noteSeq(2);
    expect(buf.getExpectedSeq()).toBe(3);

    // Next TOKEN arrives with seq=3; buffer accepts and drains.
    buf.insert(token(3, "world"));
    expect(buf.drainReadyMessages().map((m) => m.seq)).toEqual([3]);
  });

  it("noteSeq prevents a PING from blocking subsequent messages", () => {
    // The actual bug: PING at seq=2 bypasses the buffer, so the
    // buffer is stuck at expectedSeq=2. The next TOKEN at seq=3
    // gets buffered but never drains. After the fix, noteSeq(2)
    // advances expectedSeq so seq=3 drains.
    const buf = new ReorderBuffer();
    buf.insert(token(1, "a"));
    buf.drainReadyMessages(); // expectedSeq is now 2
    buf.noteSeq(2); // PING seen
    buf.insert(token(3, "c"));
    expect(buf.drainReadyMessages().map((m) => m.seq)).toEqual([3]);
  });

  it("noteSeq on a duplicate seq is a no-op", () => {
    const buf = new ReorderBuffer();
    buf.insert(token(1));
    buf.drainReadyMessages();
    buf.noteSeq(1); // already seen
    expect(buf.getExpectedSeq()).toBe(2);
  });

  it("noteSeq resyncs on a large negative gap", () => {
    const buf = new ReorderBuffer(100);
    expect(buf.getResyncCount()).toBe(0);
    buf.noteSeq(5);
    expect(buf.getResyncCount()).toBe(1);
    expect(buf.getExpectedSeq()).toBe(6);
  });
});
