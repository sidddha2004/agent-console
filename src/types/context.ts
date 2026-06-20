/**
 * A snapshot of agent context, captured when a CONTEXT_SNAPSHOT event
 * arrives. Stored in the store keyed by `context_id`; each context_id
 * has an ordered list of snapshots over time.
 */
export interface ContextSnapshot {
  contextId: string;
  seq: number;
  receivedAt: number;
  data: Record<string, unknown>;
}

/**
 * Result of comparing two JSON values. Tree-shaped so the renderer can
 * walk it once and produce a colour-coded view.
 *
 * The shape mirrors the input (objects stay objects, arrays stay
 * arrays, primitives stay primitives), but every node carries a
 * `status`. Unchanged subtrees have `status: "unchanged"`; a
 * structurally identical object subtree is represented as a single
 * unchanged node, NOT recursively expanded.
 */
export type DiffNode =
  | { kind: "primitive"; status: DiffStatus; value: string }
  | { kind: "object"; status: DiffStatus; fields: Record<string, DiffNode> }
  | { kind: "array"; status: DiffStatus; items: DiffNode[] };

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export const STATUS_COLOR: Record<DiffStatus, { bg: string; label: string }> = {
  added: { bg: "#e6ffe6", label: "added" },
  removed: { bg: "#ffe6e6", label: "removed" },
  changed: { bg: "#fff7e6", label: "changed" },
  unchanged: { bg: "transparent", label: "" },
};
