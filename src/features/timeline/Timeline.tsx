"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useAgentStore } from "@/store/agentStore";
import {
  buildTimelineRows,
  applyFilter,
  TimelineFilter,
  ALL_ROW_KINDS,
} from "@/store/timelineSelectors";
import { TimelineRow as RowView } from "./TimelineRow";
import { FilterBar } from "./FilterBar";
import { TimelineRow as RowType } from "@/types/trace";

/**
 * The collapsible side panel showing every protocol event in real time.
 *
 * Design notes:
 *  - All rendering is driven by `useMemo` on the trace Map. When a
 *    new entry is added, the Map reference changes, the memo
 *    recomputes, and only the rows whose reference changed re-render.
 *  - Auto-scroll keeps the latest row in view unless the user has
 *    scrolled away (preserves manual scroll position).
 *  - Bidirectional linking: when a tool card in the chat is clicked,
 *    it dispatches an event we listen for; when a timeline row is
 *    clicked, we dispatch an event the chat listens for.
 */
export function Timeline() {
  const trace = useAgentStore((s) => s.trace);
  const [filter, setFilter] = useState<TimelineFilter>({
    types: new Set(ALL_ROW_KINDS),
    query: "",
  });
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Build all rows (unfiltered).
  const allRows = useMemo(() => buildTimelineRows(trace), [trace]);
  // Apply the filter.
  const visibleRows = useMemo(() => applyFilter(allRows, filter), [allRows, filter]);

  // Row counts by kind (for the filter bar badges). Computed from the
  // unfiltered list so the counts don't change as the user toggles
  // kinds on/off.
  const rowCounts = useMemo(() => {
    const counts: Record<RowType["kind"], number> = {
      token_batch: 0,
      tool_call: 0,
      tool_result: 0,
      event: 0,
    };
    for (const r of allRows) counts[r.kind]++;
    return counts;
  }, [allRows]);

  // Auto-scroll to bottom when new rows arrive, unless the user has
  // scrolled up.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleRows, autoScroll]);

  // Listen for "highlight" events from the chat (bidirectional link).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ rowId: string }>).detail;
      setHighlightedRowId(detail.rowId);
      // Scroll the matching row into view.
      const el = scrollRef.current?.querySelector(
        `[data-row-id="${CSS.escape(detail.rowId)}"]`
      );
      if (el && scrollRef.current) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setAutoScroll(false);
      }
      // Clear highlight after a moment.
      setTimeout(() => setHighlightedRowId(null), 2000);
    };
    window.addEventListener("timeline:highlight", handler);
    return () => window.removeEventListener("timeline:highlight", handler);
  }, []);

  const onRowClick = (row: RowType) => {
    // Tell the chat panel to highlight the matching element.
    window.dispatchEvent(
      new CustomEvent("chat:highlight", { detail: { rowId: row.id, row } })
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fff",
      }}
    >
      <FilterBar filter={filter} onChange={setFilter} rowCounts={rowCounts} />
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 20;
          setAutoScroll(atBottom);
        }}
        style={{
          flex: 1,
          overflowY: "auto",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {visibleRows.length === 0 && (
          <div
            style={{
              padding: 12,
              color: "#999",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            No events match the filter.
          </div>
        )}
        {visibleRows.map((row) => (
          <RowView
            key={row.id}
            row={row}
            highlighted={highlightedRowId === row.id}
            onClick={onRowClick}
          />
        ))}
      </div>
      <div
        style={{
          padding: "4px 8px",
          borderTop: "1px solid #ddd",
          fontSize: 11,
          color: "#666",
          background: "#fafafa",
        }}
      >
        {visibleRows.length} of {allRows.length} events ·{" "}
        {autoScroll ? "auto-scroll on" : "auto-scroll paused"}
      </div>
    </div>
  );
}
