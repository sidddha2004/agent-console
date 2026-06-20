"use client";

import { useMemo, useState } from "react";
import { useAgentStore } from "@/store/agentStore";
import { diff } from "@/utils/diff";
import { ContextTreeView } from "./ContextTreeView";

/**
 * The context inspector panel.
 *
 * Layout:
 *  - Top: a dropdown to pick which `context_id` to view
 *  - Middle: a history scrubber (slider) to step through snapshots
 *  - Bottom: the tree view of the current snapshot, diffed against
 *    the previous one (or shown plain if it's the first snapshot)
 */
export function ContextInspector() {
  const contexts = useAgentStore((s) => s.contexts);
  const contextIds = useMemo(() => Array.from(contexts.keys()), [contexts]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Default to the first context_id once data arrives.
  const effectiveId = selectedId ?? contextIds[0] ?? null;

  const snapshots = effectiveId ? contexts.get(effectiveId) ?? [] : [];
  const [scrubberIndex, setScrubberIndex] = useState<number>(0);
  // Keep the scrubber in range as new snapshots arrive.
  const safeIndex = Math.min(scrubberIndex, Math.max(0, snapshots.length - 1));
  const current = snapshots[safeIndex];
  const previous = safeIndex > 0 ? snapshots[safeIndex - 1] : undefined;

  const diffTree = useMemo(() => {
    if (!current) return null;
    if (!previous) return null;
    return diff(previous.data, current.data);
  }, [current, previous]);

  if (contextIds.length === 0) {
    return (
      <div style={{ padding: 12, color: "#999", fontSize: 12 }}>
        No context snapshots yet. Send a message that triggers a CONTEXT_SNAPSHOT
        (e.g. &ldquo;summarise the q3 report&rdquo;).
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fff",
      }}
    >
      <div
        style={{
          padding: 8,
          borderBottom: "1px solid #ddd",
          background: "#fafafa",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <label style={{ fontSize: 11, color: "#666" }}>
          Context ID
          <select
            value={effectiveId ?? ""}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setScrubberIndex(0);
            }}
            style={{
              marginLeft: 6,
              padding: "2px 4px",
              fontSize: 12,
              border: "1px solid #ccc",
              borderRadius: 3,
              width: "100%",
            }}
          >
            {contextIds.map((id) => (
              <option key={id} value={id}>
                {id} ({contexts.get(id)?.length ?? 0} snapshot
                {(contexts.get(id)?.length ?? 0) === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 11, color: "#666" }}>
          Snapshot {safeIndex + 1} of {snapshots.length}
          {current && (
            <span style={{ marginLeft: 6, color: "#888" }}>
              (seq {current.seq})
            </span>
          )}
          <input
            type="range"
            min={0}
            max={Math.max(0, snapshots.length - 1)}
            value={safeIndex}
            onChange={(e) => setScrubberIndex(Number(e.target.value))}
            style={{ width: "100%" }}
            disabled={snapshots.length === 0}
          />
        </label>

        <div style={{ fontSize: 11, color: "#666" }}>
          {previous
            ? `Diff against snapshot ${safeIndex} (seq ${previous.seq})`
            : "First snapshot — no diff available"}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 8,
        }}
      >
        {current && diffTree && (
          <ContextTreeView node={diffTree} label="root" depth={0} />
        )}
        {current && !diffTree && (
          <PlainView data={current.data} />
        )}
      </div>
    </div>
  );
}

function PlainView({ data }: { data: Record<string, unknown> }) {
  // For the first snapshot (no previous to diff against), show a
  // plain (but collapsible) tree built from the raw data.
  const pseudoNode = useMemo(() => {
    return {
      kind: "object" as const,
      status: "unchanged" as const,
      fields: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
          k,
          v && typeof v === "object" && !Array.isArray(v)
            ? {
                kind: "object" as const,
                status: "unchanged" as const,
                fields: Object.fromEntries(
                  Object.entries(v as Record<string, unknown>).map(([k2, v2]) => [
                    k2,
                    primitiveOrRecurse(v2),
                  ])
                ),
              }
            : primitiveOrRecurse(v),
        ])
      ),
    };
  }, [data]);

  return <ContextTreeView node={pseudoNode} label="root" depth={0} />;
}

function primitiveOrRecurse(v: unknown): import("@/types/context").DiffNode {
  if (v === null || v === undefined) {
    return { kind: "primitive", status: "unchanged", value: String(v) };
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    return {
      kind: "object",
      status: "unchanged",
      fields: Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, vv]) => [k, primitiveOrRecurse(vv)])
      ),
    };
  }
  if (Array.isArray(v)) {
    return {
      kind: "array",
      status: "unchanged",
      items: v.map(primitiveOrRecurse),
    };
  }
  return { kind: "primitive", status: "unchanged", value: JSON.stringify(v) };
}
