import { describe, it, expect } from "vitest";
import { buildTimelineRows, applyFilter } from "./timelineSelectors";
import { TraceEntry } from "@/types/trace";
import { ServerMessage } from "@/protocol/messages";

const entry = (msg: ServerMessage, t: number = 0): TraceEntry => ({
  seq: msg.seq,
  receivedAt: t,
  message: msg,
});

const trace = (...msgs: ServerMessage[]) => {
  const m = new Map<number, TraceEntry>();
  for (const msg of msgs) m.set(msg.seq, entry(msg));
  return m;
};

describe("buildTimelineRows", () => {
  it("returns no rows for an empty trace", () => {
    expect(buildTimelineRows(new Map())).toEqual([]);
  });

  it("groups consecutive tokens into one batch", () => {
    const t = trace(
      { type: "TOKEN", seq: 1, text: "a", stream_id: "s1" },
      { type: "TOKEN", seq: 2, text: "b", stream_id: "s1" },
      { type: "TOKEN", seq: 3, text: "c", stream_id: "s1" }
    );
    const rows = buildTimelineRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("token_batch");
    if (rows[0].kind === "token_batch") {
      expect(rows[0].count).toBe(3);
      expect(rows[0].text).toBe("abc");
      expect(rows[0].firstSeq).toBe(1);
      expect(rows[0].lastSeq).toBe(3);
    }
  });

  it("starts a new batch after a non-token event", () => {
    const t = trace(
      { type: "TOKEN", seq: 1, text: "a", stream_id: "s1" },
      { type: "TOKEN", seq: 2, text: "b", stream_id: "s1" },
      {
        type: "TOOL_CALL",
        seq: 3,
        call_id: "c1",
        tool_name: "lookup",
        args: {},
        stream_id: "s1",
      },
      { type: "TOKEN", seq: 4, text: "c", stream_id: "s1" }
    );
    const rows = buildTimelineRows(t);
    expect(rows).toHaveLength(3);
    expect(rows[0].kind).toBe("token_batch");
    expect(rows[1].kind).toBe("tool_call");
    expect(rows[2].kind).toBe("token_batch");
    if (rows[2].kind === "token_batch") {
      expect(rows[2].count).toBe(1);
    }
  });

  it("starts a new batch when stream_id changes", () => {
    const t = trace(
      { type: "TOKEN", seq: 1, text: "a", stream_id: "s1" },
      { type: "TOKEN", seq: 2, text: "b", stream_id: "s2" }
    );
    const rows = buildTimelineRows(t);
    expect(rows).toHaveLength(2);
  });

  it("marks tool_call.hasResult when matching tool_result exists", () => {
    const t = trace(
      {
        type: "TOOL_CALL",
        seq: 1,
        call_id: "c1",
        tool_name: "lookup",
        args: {},
        stream_id: "s1",
      },
      {
        type: "TOOL_RESULT",
        seq: 2,
        call_id: "c1",
        result: { ok: true },
        stream_id: "s1",
      }
    );
    const rows = buildTimelineRows(t);
    const call = rows.find((r) => r.kind === "tool_call");
    expect(call && call.kind === "tool_call" ? call.hasResult : false).toBe(true);
  });

  it("keeps tool_call.hasResult false when no matching tool_result", () => {
    const t = trace({
      type: "TOOL_CALL",
      seq: 1,
      call_id: "c1",
      tool_name: "lookup",
      args: {},
      stream_id: "s1",
    });
    const rows = buildTimelineRows(t);
    const call = rows[0];
    expect(call.kind === "tool_call" && call.hasResult).toBe(false);
  });

  it("emits a separate row for each PING", () => {
    const t = trace(
      { type: "PING", seq: 1, challenge: "x" },
      { type: "PING", seq: 5, challenge: "y" }
    );
    const rows = buildTimelineRows(t);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("event");
  });

  it("emits CONTEXT_SNAPSHOT and ERROR as event rows", () => {
    const t = trace(
      { type: "CONTEXT_SNAPSHOT", seq: 1, context_id: "ctx1", data: { a: 1 } },
      { type: "ERROR", seq: 2, code: "X", message: "boom" }
    );
    const rows = buildTimelineRows(t);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(["event", "event"]);
  });
});

describe("applyFilter", () => {
  const sampleTrace = trace(
    { type: "TOKEN", seq: 1, text: "hello world", stream_id: "s1" },
    {
      type: "TOOL_CALL",
      seq: 2,
      call_id: "c1",
      tool_name: "search_docs",
      args: { q: "x" },
      stream_id: "s1",
    },
    {
      type: "TOOL_RESULT",
      seq: 3,
      call_id: "c1",
      result: { matches: 5 },
      stream_id: "s1",
    },
    { type: "PING", seq: 4, challenge: "z" }
  );
  const rows = buildTimelineRows(sampleTrace);

  it("returns all rows when no filter is set", () => {
    const out = applyFilter(rows, {
      types: new Set(["token_batch", "tool_call", "tool_result", "event"]),
      query: "",
    });
    expect(out).toHaveLength(rows.length);
  });

  it("filters by kind", () => {
    const out = applyFilter(rows, {
      types: new Set(["tool_call"]),
      query: "",
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("tool_call");
  });

  it("filters by free-text search across content", () => {
    const out = applyFilter(rows, {
      types: new Set(["token_batch", "tool_call", "tool_result", "event"]),
      query: "search",
    });
    // Matches the tool_call (tool_name) but not the others.
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("tool_call");
  });

  it("combines kind filter and text search", () => {
    const out = applyFilter(rows, {
      types: new Set(["token_batch"]),
      query: "hello",
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("token_batch");
  });

  it("returns empty when no row matches", () => {
    const out = applyFilter(rows, {
      types: new Set(["token_batch", "tool_call", "tool_result", "event"]),
      query: "nothing-matches-this",
    });
    expect(out).toEqual([]);
  });
});
