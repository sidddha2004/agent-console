"use client";

import { TimelineFilter, ALL_ROW_KINDS } from "@/store/timelineSelectors";
import { TimelineRow } from "@/types/trace";

const KIND_LABEL: Record<TimelineRow["kind"], string> = {
  token_batch: "Tokens",
  tool_call: "Tool Calls",
  tool_result: "Tool Results",
  event: "Other Events",
};

interface Props {
  filter: TimelineFilter;
  onChange: (filter: TimelineFilter) => void;
  rowCounts: Record<TimelineRow["kind"], number>;
}

export function FilterBar({ filter, onChange, rowCounts }: Props) {
  const toggleKind = (kind: TimelineRow["kind"]) => {
    const next = new Set(filter.types);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    onChange({ ...filter, types: next });
  };

  return (
    <div
      style={{
        padding: "8px",
        borderBottom: "1px solid #ddd",
        background: "#fafafa",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <input
        type="text"
        placeholder="Search timeline…"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
        style={{
          padding: "4px 6px",
          fontSize: 12,
          border: "1px solid #ccc",
          borderRadius: 3,
        }}
      />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {ALL_ROW_KINDS.map((kind) => {
          const active = filter.types.has(kind);
          const count = rowCounts[kind] ?? 0;
          return (
            <button
              key={kind}
              onClick={() => toggleKind(kind)}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                border: "1px solid #ccc",
                borderRadius: 12,
                background: active ? "#0066cc" : "#fff",
                color: active ? "#fff" : "#333",
                cursor: "pointer",
              }}
            >
              {KIND_LABEL[kind]} ({count})
            </button>
          );
        })}
      </div>
    </div>
  );
}
