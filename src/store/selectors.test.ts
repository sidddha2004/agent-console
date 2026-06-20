import { describe, it, expect } from "vitest";
import { getStreams } from "./selectors";
import { ServerMessage } from "@/protocol/messages";

describe("getStreams", () => {
  it("returns no streams for no messages", () => {
    expect(getStreams([])).toEqual([]);
  });

  it("concatenates consecutive tokens into one text segment", () => {
    const messages: ServerMessage[] = [
      { type: "TOKEN", seq: 1, text: "Hello", stream_id: "s1" },
      { type: "TOKEN", seq: 2, text: " world", stream_id: "s1" },
      { type: "TOKEN", seq: 3, text: "!", stream_id: "s1" },
    ];
    const [stream] = getStreams(messages);
    expect(stream.segments).toEqual([{ kind: "text", text: "Hello world!" }]);
    expect(stream.completed).toBe(false);
  });

  it("opens a new text segment AFTER a tool call", () => {
    const messages: ServerMessage[] = [
      { type: "TOKEN", seq: 1, text: "Before tool. ", stream_id: "s1" },
      {
        type: "TOOL_CALL",
        seq: 2,
        call_id: "c1",
        tool_name: "lookup",
        args: { q: "x" },
        stream_id: "s1",
      },
      { type: "TOKEN", seq: 3, text: "After tool.", stream_id: "s1" },
    ];
    const [stream] = getStreams(messages);
    expect(stream.segments).toHaveLength(3);
    expect(stream.segments[0]).toEqual({ kind: "text", text: "Before tool. " });
    expect(stream.segments[1].kind).toBe("tool");
    expect(stream.segments[2]).toEqual({ kind: "text", text: "After tool." });
  });

  it("keeps the tool segment's position when its result arrives", () => {
    const messages: ServerMessage[] = [
      { type: "TOKEN", seq: 1, text: "A", stream_id: "s1" },
      {
        type: "TOOL_CALL",
        seq: 2,
        call_id: "c1",
        tool_name: "lookup",
        args: {},
        stream_id: "s1",
      },
      { type: "TOKEN", seq: 3, text: "B", stream_id: "s1" },
      {
        type: "TOOL_RESULT",
        seq: 4,
        call_id: "c1",
        result: { value: 42 },
        stream_id: "s1",
      },
    ];
    const [stream] = getStreams(messages);
    expect(stream.segments).toHaveLength(3);
    // Tool is still at index 1, just with updated status/result.
    const tool = stream.segments[1];
    expect(tool.kind).toBe("tool");
    if (tool.kind === "tool") {
      expect(tool.status).toBe("completed");
      expect(tool.result).toEqual({ value: 42 });
    }
  });

  it("marks in-flight tools as stuck when offline", () => {
    const messages: ServerMessage[] = [
      {
        type: "TOOL_CALL",
        seq: 1,
        call_id: "c1",
        tool_name: "lookup",
        args: {},
        stream_id: "s1",
      },
    ];
    const [online] = getStreams(messages, "connected");
    const [offline] = getStreams(messages, "reconnecting");
    expect((online.segments[0] as { status: string }).status).toBe("running");
    expect((offline.segments[0] as { status: string }).status).toBe("stuck");
  });

  it("handles multiple streams independently", () => {
    const messages: ServerMessage[] = [
      { type: "TOKEN", seq: 1, text: "A1", stream_id: "s1" },
      { type: "TOKEN", seq: 2, text: "B1", stream_id: "s2" },
      { type: "STREAM_END", seq: 3, stream_id: "s1" },
    ];
    const streams = getStreams(messages);
    const s1 = streams.find((s) => s.streamId === "s1")!;
    const s2 = streams.find((s) => s.streamId === "s2")!;
    expect(s1.completed).toBe(true);
    expect(s2.completed).toBe(false);
  });
});
