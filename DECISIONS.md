Decisions
1. Seq-based ordering and deduplication

The protocol's seq field is the single source of truth for message order. To handle out-of-order delivery, I built a ReorderBuffer that stores messages in a Map, tracks the next expected sequence (expectedSeq), and uses a Set (seenSeq) to remove duplicates.

A Map was chosen because inserts and lookups are O(1). An array would require repeated sorting whenever messages arrive out of order.

The buffer processes messages only when the next expected sequence exists. If there is a gap, processing pauses until the missing message arrives, ensuring messages always appear in order.

To handle server resets, I added a resync rule: if a message arrives with seq < expectedSeq - 10, the client treats it as a fresh session and resets the buffer. The threshold is large enough to ignore normal reordering (usually 2–5 messages) while still detecting real state drift. Resync also updates resyncCount so the socket manager can reset lastProcessedSeq.

2. Preventing layout shifts during tool calls

Responses are stored as ordered TextSegment and ToolSegment objects, rendered by position rather than content.

TOKEN updates only the latest text segment.
TOOL_CALL appends a new tool segment.
TOOL_RESULT updates the existing tool segment in place.

Unchanged segments keep the same reference, so React avoids unnecessary re-renders. Tool cards also have a fixed minimum height (60px) to prevent jumping when their status changes.

Result: text above a tool call never moves, even when the result arrives later.

3. Reconnection and recovery

The store tracks lastProcessedSeq, the highest sequence number already rendered in the UI.

On reconnect:

Send RESUME with lastProcessedSeq.
Start the buffer at lastProcessedSeq + 1.
Replay all newer events from the server.
Deduplicate and process them in order.

If a disconnect happens during a tool call, it remains in the "Running" state until the replayed TOOL_RESULT arrives and updates the same segment.

Reconnect backoff is:

500ms → 1s → 2s → 4s → 8s → 10s (max)

A message is considered "consumed" once it has been stored and rendered.

4. Protocol failure modes

A race condition exists around TOOL_ACK.

The server waits up to 5 seconds for an ACK after sending TOOL_CALL, but the client only ACKs after rendering the tool card. Under heavy reordering, the tool call can sit in the buffer long enough for the server timeout to fire even though the client behaved correctly.

This requires a server-side fix, such as increasing the timeout or allowing earlier ACKs.

Another edge case is that a TOOL_CALL may appear before earlier text from the same stream if its sequence number is lower. Since the UI follows global seq ordering, this behavior is expected and matches the protocol.

5. Scaling to 50 concurrent streams

The current global message list would struggle with 50 streams generating 30+ events per second.

To scale:

Use a separate ReorderBuffer per stream_id.
Move large context diffs to Web Workers.
Virtualize the timeline (react-window / react-virtuoso).
Use pub-sub style store subscriptions.
Keep a single multiplexed WebSocket with stream_id on each event.

The biggest improvement comes from per-stream buffers.

6. Scaling to very long responses

Storing every TOKEN as a separate message does not scale for large documents.

To improve this:

Merge token runs into a single text segment.
Collapse completed token traces into summaries.
Virtualize text rendering.
Stream document slices instead of rendering everything at once.
Keep a segment-based model for search and referencing.

The most important change is collapsing token runs in storage.