import { describe, it, expect } from "vitest";
import { diff } from "./diff";

describe("diff", () => {
  it("returns unchanged for identical primitives", () => {
    const result = diff(42, 42);
    expect(result).toEqual({
      kind: "primitive",
      status: "unchanged",
      value: "42",
    });
  });

  it("returns changed for different primitives", () => {
    const result = diff(42, 43);
    expect(result.status).toBe("changed");
    expect(result.kind).toBe("primitive");
  });

  it("treats null as a primitive", () => {
    expect(diff(null, null).status).toBe("unchanged");
    expect(diff(null, 1).status).toBe("changed");
  });

  it("marks added keys at the object level", () => {
    const result = diff({ a: 1 }, { a: 1, b: 2 });
    expect(result.kind).toBe("object");
    if (result.kind === "object") {
      expect(result.status).toBe("changed");
      expect(result.fields.b?.status).toBe("added");
      expect(result.fields.a?.status).toBe("unchanged");
    }
  });

  it("omits removed keys from the result", () => {
    const result = diff({ a: 1, b: 2 }, { a: 1 });
    expect(result.kind).toBe("object");
    if (result.kind === "object") {
      expect(result.status).toBe("changed");
      expect(result.fields.a?.status).toBe("unchanged");
      expect(result.fields.b).toBeUndefined();
    }
  });

  it("marks changed leaves inside an object as changed", () => {
    const result = diff({ a: 1, b: 2 }, { a: 1, b: 3 });
    if (result.kind === "object") {
      expect(result.status).toBe("changed");
      expect(result.fields.a?.status).toBe("unchanged");
      expect(result.fields.b?.status).toBe("changed");
    }
  });

  it("marks a fully unchanged object as unchanged", () => {
    const result = diff({ a: 1, b: 2 }, { a: 1, b: 2 });
    expect(result.status).toBe("unchanged");
  });

  it("recurses into nested objects", () => {
    const result = diff(
      { outer: { inner: 1 } },
      { outer: { inner: 2 } }
    );
    if (result.kind === "object") {
      expect(result.status).toBe("changed");
      const outer = result.fields.outer;
      if (outer && outer.kind === "object") {
        expect(outer.status).toBe("changed");
        expect(outer.fields.inner?.status).toBe("changed");
      }
    }
  });

  it("compares arrays positionally", () => {
    const result = diff([1, 2, 3], [1, 9, 3]);
    if (result.kind === "array") {
      expect(result.status).toBe("changed");
      expect(result.items[0]?.status).toBe("unchanged");
      expect(result.items[1]?.status).toBe("changed");
      expect(result.items[2]?.status).toBe("unchanged");
    }
  });

  it("marks appended array items as added", () => {
    const result = diff([1, 2], [1, 2, 3]);
    if (result.kind === "array") {
      expect(result.items).toHaveLength(3);
      expect(result.items[2]?.status).toBe("added");
    }
  });

  it("handles large payloads in under 100ms", () => {
    // Generate a 500KB-ish payload.
    const big = (): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < 5000; i++) {
        out[`key_${i}`] = {
          id: i,
          name: `item-${i}`,
          tags: ["alpha", "beta", "gamma"],
          meta: { created: 1700000000 + i, active: i % 2 === 0 },
        };
      }
      return out;
    };
    const a = big();
    const b = big();
    // Mutate a few keys to make it a "real" diff.
    b.key_42 = { ...(b.key_42 as object), name: "changed" };
    b.key_100 = { ...(b.key_100 as object), name: "changed" };

    const t0 = performance.now();
    const result = diff(a, b);
    const elapsed = performance.now() - t0;
    expect(result.kind).toBe("object");
    if (result.kind === "object") {
      expect(result.status).toBe("changed");
    }
    expect(elapsed).toBeLessThan(100);
  });

  it("marks an unchanged nested subtree as a single unchanged node", () => {
    // This is the structural-sharing test: if a nested object is
    // identical, we don't expand its children.
    const result = diff(
      { big: { a: 1, b: 2, c: 3 }, other: 1 },
      { big: { a: 1, b: 2, c: 3 }, other: 2 }
    );
    if (result.kind === "object") {
      const big = result.fields.big;
      expect(big?.status).toBe("unchanged");
    }
  });
});
