"use client";

import { memo } from "react";
import { DiffNode, STATUS_COLOR } from "@/types/context";

interface Props {
  node: DiffNode;
  /**
   * If provided, render the node as a labelled child of this key
   * (e.g. "<key>: value"). Top-level calls pass undefined.
   */
  label?: string;
  depth?: number;
}

/**
 * Recursive tree view of a DiffNode.
 *
 * Why <details> for collapse: native browser handling, zero React
 * re-renders on toggle, and crucially — collapsed children don't
 * enter the DOM at all. For a 500KB payload, only the visible
 * top-level keys are mounted; the rest stay as unparsed HTML until
 * the user expands them.
 */
function ContextTreeViewImpl({ node, label, depth = 0 }: Props) {
  const indent = { paddingLeft: depth * 12 };

  if (node.kind === "primitive") {
    return <PrimitiveRow label={label} status={node.status} value={node.value} indent={indent} />;
  }

  if (node.kind === "object") {
    const keys = Object.keys(node.fields);
    if (keys.length === 0) {
      return <PrimitiveRow label={label} status={node.status} value="{}" indent={indent} />;
    }
    return (
      <details open={depth < 2} style={indent}>
        <summary style={{ cursor: "pointer", userSelect: "none" }}>
          <StatusBadge status={node.status} />
          {label !== undefined && <strong>{label}</strong>}{" "}
          <span style={{ color: "#888" }}>
            {"{"} {keys.length} field{keys.length === 1 ? "" : "s"} {"}"}
          </span>
        </summary>
        <div style={{ marginLeft: 8 }}>
          {keys.map((key) => (
            <ContextTreeView
              key={key}
              node={node.fields[key]!}
              label={key}
              depth={depth + 1}
            />
          ))}
        </div>
      </details>
    );
  }

  // Array
  if (node.items.length === 0) {
    return <PrimitiveRow label={label} status={node.status} value="[]" indent={indent} />;
  }
  return (
    <details open={depth < 2} style={indent}>
      <summary style={{ cursor: "pointer", userSelect: "none" }}>
        <StatusBadge status={node.status} />
        {label !== undefined && <strong>{label}</strong>}{" "}
        <span style={{ color: "#888" }}>
          [{" "}{node.items.length} item{node.items.length === 1 ? "" : "s"} ]
        </span>
      </summary>
      <div style={{ marginLeft: 8 }}>
        {node.items.map((item, i) => (
          <ContextTreeView
            key={i}
            node={item}
            label={`[${i}]`}
            depth={depth + 1}
          />
        ))}
      </div>
    </details>
  );
}

function PrimitiveRow({
  label,
  status,
  value,
  indent,
}: {
  label?: string;
  status: DiffNode["status"];
  value: string;
  indent: React.CSSProperties;
}) {
  const color = STATUS_COLOR[status];
  return (
    <div
      style={{
        ...indent,
        background: color.bg,
        padding: "1px 4px",
        fontFamily: "ui-monospace, monospace",
        fontSize: 12,
      }}
    >
      <StatusBadge status={status} />
      {label !== undefined && <strong>{label}</strong>}{" "}
      <span style={{ color: "#333" }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: DiffNode["status"] }) {
  if (status === "unchanged") return null;
  const color = STATUS_COLOR[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0 4px",
        marginRight: 4,
        fontSize: 10,
        fontWeight: 600,
        background: color.bg,
        border: `1px solid ${status === "added" ? "#009933" : status === "removed" ? "#cc0000" : "#cc6600"}`,
        borderRadius: 3,
        color: status === "added" ? "#006622" : status === "removed" ? "#990000" : "#995500",
      }}
    >
      {color.label}
    </span>
  );
}

export const ContextTreeView = memo(ContextTreeViewImpl);
