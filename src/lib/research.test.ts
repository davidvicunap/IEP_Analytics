import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/client";
import { LIMITS, applyInput, emptyNote, fairValueHistory, isStale, parseInput, upside } from "./research";
import { memoryStore, postgresStore, type ResearchStore } from "./researchStore";

let ids = 0;
const newId = () => `id${++ids}`;
const at = (s: string) => new Date(`2026-11-11T${s}:00Z`);

describe("validating edits", () => {
  it("accepts partial edits and trims text", () => {
    expect(parseInput({ thesis: "  Moat + buybacks  ", fairValue: 250.123456 })).toEqual({ ok: true, input: { thesis: "Moat + buybacks", fairValue: 250.1235, baseUpdatedAt: null } });
    expect(parseInput({ fairValue: null, baseUpdatedAt: "2026-11-11T10:00:00Z" })).toEqual({ ok: true, input: { fairValue: null, baseUpdatedAt: "2026-11-11T10:00:00.000Z" } });
    expect(parseInput({ addNote: "   " })).toEqual({ ok: true, input: { baseUpdatedAt: null } });
  });

  it("rejects bad types, negative or absurd prices and oversized text", () => {
    for (const bad of [null, "x", { thesis: 5 }, { fairValue: -1 }, { fairValue: 0 }, { stop: Infinity }, { fairValue: "10" }, { target: 2e9 }, { fairValueSource: "magic" }, { thesis: "x".repeat(LIMITS.text + 1) }, { addNote: "x".repeat(LIMITS.note + 1) }, { baseUpdatedAt: "yesterday" }]) {
      expect(parseInput(bad)).toEqual({ ok: false, error: "invalid" });
    }
  });
});

describe("applying edits", () => {
  it("keeps fields an edit doesn't mention", () => {
    const first = applyInput(null, "AAPL", { thesis: "Ecosystem", bull: "Services", entry: 200, baseUpdatedAt: null }, at("10:00"), newId);
    const second = applyInput(first, "AAPL", { bear: "China", baseUpdatedAt: first.updatedAt }, at("11:00"), newId);
    expect(second).toMatchObject({ symbol: "AAPL", thesis: "Ecosystem", bull: "Services", bear: "China", entry: 200, updatedAt: "2026-11-11T11:00:00.000Z" });
  });

  it("records each fair-value change with the price shown and how it was set", () => {
    const a = applyInput(null, "AAPL", { fairValue: 250, price: 230, baseUpdatedAt: null }, at("10:00"), newId);
    const b = applyInput(a, "AAPL", { thesis: "same value", fairValue: 250, price: 231, baseUpdatedAt: a.updatedAt }, at("10:30"), newId);
    const c = applyInput(b, "AAPL", { fairValue: 271.5, fairValueSource: "dcf", price: 228, baseUpdatedAt: b.updatedAt }, at("11:00"), newId);
    const d = applyInput(c, "AAPL", { fairValue: null, baseUpdatedAt: c.updatedAt }, at("12:00"), newId);
    expect(fairValueHistory(d).map((e) => [e.value, e.price, e.source])).toEqual([
      [250, 230, "manual"],
      [271.5, 228, "dcf"],
      [null, null, "manual"],
    ]);
  });

  it("adds and removes dated notes, newest first", () => {
    const a = applyInput(null, "MSFT", { addNote: "Earnings beat", baseUpdatedAt: null }, at("10:00"), newId);
    const b = applyInput(a, "MSFT", { addNote: "Guidance raised", baseUpdatedAt: a.updatedAt }, at("11:00"), newId);
    expect(b.log.map((e) => e.kind === "note" && e.text)).toEqual(["Guidance raised", "Earnings beat"]);
    const c = applyInput(b, "MSFT", { removeNote: b.log[1].id, baseUpdatedAt: b.updatedAt }, at("12:00"), newId);
    expect(c.log.map((e) => e.kind === "note" && e.text)).toEqual(["Guidance raised"]);
  });

  it("keeps at most the newest entries", () => {
    let n = emptyNote("X");
    for (let i = 0; i < LIMITS.log + 5; i++) n = applyInput(n, "X", { addNote: `n${i}`, baseUpdatedAt: n.updatedAt }, at("10:00"), newId);
    expect(n.log).toHaveLength(LIMITS.log);
    expect(n.log[0]).toMatchObject({ text: `n${LIMITS.log + 4}` });
  });

  it("detects an edit made from an older version", () => {
    const saved = applyInput(null, "X", { thesis: "v1", baseUpdatedAt: null }, at("10:00"), newId);
    expect(isStale(null, { baseUpdatedAt: null })).toBe(false);
    expect(isStale(saved, { thesis: "v2", baseUpdatedAt: saved.updatedAt })).toBe(false);
    expect(isStale(saved, { thesis: "v2", baseUpdatedAt: null })).toBe(true);
    expect(isStale(saved, { thesis: "v2", baseUpdatedAt: "2026-11-11T09:00:00.000Z" })).toBe(true);
    // Notes and fair values from another device never block each other.
    expect(isStale(saved, { addNote: "later", baseUpdatedAt: null })).toBe(false);
    expect(isStale(saved, { fairValue: 10, fairValueSource: "dcf", baseUpdatedAt: null })).toBe(false);
  });

  it("measures the fair value against the price", () => {
    expect(upside(120, 100)).toBeCloseTo(0.2);
    expect(upside(80, 100)).toBeCloseTo(-0.2);
    expect(upside(null, 100)).toBeNull();
    expect(upside(100, null)).toBeNull();
  });
});

let pg: Db;
beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  pg = db as unknown as Db;
});

describe.each([
  ["Postgres (real migration on PGlite)", () => postgresStore(pg)],
  ["memory (demo)", () => memoryStore()],
])("research store: %s", (_name, make: () => ResearchStore) => {
  it("saves, reads, lists per owner and removes", async () => {
    const store = make();
    const r1 = await store.save("david", "AAPL", { thesis: "Ecosystem", fairValue: 250, price: 230, baseUpdatedAt: null }, at("10:00"));
    expect(r1.ok).toBe(true);
    await store.save("david", "MSFT", { thesis: "Cloud", baseUpdatedAt: null }, at("11:00"));
    await store.save("ana", "AAPL", { thesis: "Not David's", baseUpdatedAt: null }, at("12:00"));

    const aapl = await store.get("david", "AAPL");
    expect(aapl).toMatchObject({ symbol: "AAPL", thesis: "Ecosystem", fairValue: 250, updatedAt: "2026-11-11T10:00:00.000Z" });
    expect(aapl?.log[0]).toMatchObject({ kind: "fairValue", value: 250, price: 230 });
    expect((await store.list("david")).map((n) => n.symbol)).toEqual(["MSFT", "AAPL"]); // newest first
    expect((await store.get("ana", "AAPL"))?.thesis).toBe("Not David's");

    await store.remove("david", "AAPL");
    expect(await store.get("david", "AAPL")).toBeNull();
    expect((await store.list("david")).map((n) => n.symbol)).toEqual(["MSFT"]);
  });

  it("refuses an edit made from an outdated version instead of overwriting", async () => {
    const store = make();
    const first = await store.save("david", "NVDA", { thesis: "v1", baseUpdatedAt: null }, at("10:00"));
    if (!first.ok) throw new Error("save failed");
    const tabA = await store.save("david", "NVDA", { thesis: "from tab A", baseUpdatedAt: first.note.updatedAt }, at("10:05"));
    expect(tabA.ok).toBe(true);
    const tabB = await store.save("david", "NVDA", { thesis: "from tab B", baseUpdatedAt: first.note.updatedAt }, at("10:06"));
    expect(tabB).toEqual({ ok: false, error: "conflict" });
    expect((await store.get("david", "NVDA"))?.thesis).toBe("from tab A");
    // A first save over an existing note is also an outdated edit.
    expect(await store.save("david", "NVDA", { thesis: "blind", baseUpdatedAt: null }, at("10:07"))).toEqual({ ok: false, error: "conflict" });
  });
});
