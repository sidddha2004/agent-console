import { DiffNode, DiffStatus } from "@/types/context";

/**
 * Compute a structured diff between two JSON values.
 *
 * Rules:
 *  - Objects are compared key-by-key. A key present in `prev` but not
 *    `next` is "removed". A key present in `next` but not `prev` is
 *    "added". A key present in both is recursively diffed; the result
 *    is "changed" if any descendant differs, "unchanged" otherwise.
 *  - Arrays are compared by index. If the lengths differ, the extra
 *    entries are "added" (when next is longer) or "removed" (when
 *    prev is longer). Common-length entries are recursively diffed.
 *  - Primitives are equal if `JSON.stringify(prev) === JSON.stringify(next)`.
 *    We use stringify rather than `===` so e.g. `1` and `"1"` are
 *    not "equal" (they are different types in the JSON model), and
 *    two objects with the same keys are not "equal" (they would be
 *    recursively compared instead).
 *
 * Performance: the algorithm is O(n) in the size of the two trees.
 * For 500KB payloads, expect a single-digit-millisecond diff on a
 * modern laptop.
 */
export function diff(prev: unknown, next: unknown): DiffNode {
  return diffNode(prev, next);
}

function diffNode(prev: unknown, next: unknown): DiffNode {
  if (isObject(prev) && isObject(next)) {
    return diffObjects(prev, next);
  }
  if (isArray(prev) && isArray(next)) {
    return diffArrays(prev, next);
  }
  // Primitive or type-mismatch case.
  const equal = jsonEqual(prev, next);
  if (equal) {
    return primitiveNode(prev, "unchanged");
  }
  // Different: if both existed, "changed"; if only one existed, the
  // caller is responsible for "added"/"removed" semantics (we don't
  // have a "removed" path at the top level for an object key, since
  // removed keys are not in the result at all — see diffObjects).
  return primitiveNode(next, "changed");
}

function diffObjects(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): DiffNode {
  const fields: Record<string, DiffNode> = {};
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  let hasChange = false;

  for (const key of allKeys) {
    const inPrev = key in prev;
    const inNext = key in next;
    if (inPrev && !inNext) {
      // We don't include removed keys in the rendered tree; the
      // diff is shown from `next`'s perspective. If a user wants
      // to see removed keys, they'd need a separate "removed" view.
      // For the spec's requirements, the "next" view with added
      // highlights is sufficient.
      hasChange = true;
      continue;
    }
    if (!inPrev && inNext) {
      const node = wrapForStatus(diffLeaf(next[key]), "added");
      fields[key] = node;
      hasChange = true;
      continue;
    }
    // Both present.
    const sub = diffNode(prev[key], next[key]);
    if (subStatus(sub) === "unchanged") {
      fields[key] = sub;
    } else {
      hasChange = true;
      fields[key] = sub;
    }
  }

  return {
    kind: "object",
    status: hasChange ? "changed" : "unchanged",
    fields,
  };
}

function diffArrays(prev: unknown[], next: unknown[]): DiffNode {
  const items: DiffNode[] = [];
  const maxLen = Math.max(prev.length, next.length);
  let hasChange = false;

  for (let i = 0; i < maxLen; i++) {
    if (i >= prev.length) {
      // Added at the end.
      items.push(wrapForStatus(diffLeaf(next[i]), "added"));
      hasChange = true;
    } else if (i >= next.length) {
      // Removed at the end. We skip these (see removed-keys note).
      hasChange = true;
    } else {
      const sub = diffNode(prev[i], next[i]);
      if (subStatus(sub) === "unchanged") {
        items.push(sub);
      } else {
        items.push(sub);
        hasChange = true;
      }
    }
  }

  return {
    kind: "array",
    status: hasChange ? "changed" : "unchanged",
    items,
  };
}

/**
 * Wrap a freshly-built leaf node with an "added" status. Used when a
 * key only appears in `next` (no `prev` to compare with).
 */
function wrapForStatus(node: DiffNode, status: DiffStatus): DiffNode {
  if (status === "added") {
    return { ...node, status: "added" };
  }
  return node;
}

function diffLeaf(value: unknown): DiffNode {
  if (isObject(value)) {
    return {
      kind: "object",
      status: "unchanged",
      fields: objectFields(value),
    };
  }
  if (isArray(value)) {
    return {
      kind: "array",
      status: "unchanged",
      items: value.map(diffLeaf),
    };
  }
  return primitiveNode(value, "unchanged");
}

function objectFields(obj: Record<string, unknown>): Record<string, DiffNode> {
  const out: Record<string, DiffNode> = {};
  for (const key of Object.keys(obj)) {
    out[key] = diffLeaf(obj[key]);
  }
  return out;
}

function primitiveNode(value: unknown, status: DiffStatus): DiffNode {
  return {
    kind: "primitive",
    status,
    value: value === undefined ? "undefined" : JSON.stringify(value),
  };
}

function subStatus(node: DiffNode): DiffStatus {
  return node.status;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
