"use client";

import { ReactNode } from "react";

/**
 * Read-only, copyable, scrollable container for a chat stream.
 *
 * The container itself is a stable DOM node; its children are appended
 * but never reordered or removed, so the user's scroll position is
 * preserved across re-renders.
 */
export function StreamView({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #ccc",
        padding: "12px",
        marginBottom: "12px",
        borderRadius: "4px",
        background: "#fff",
      }}
    >
      {children}
    </div>
  );
}
