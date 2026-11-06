import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCharacterSpawnGraph,
  buildSceneSpawnGraph,
  isAgentResultJob,
  normalizeAgentCharacters,
  normalizeAgentScenes,
  pickBestVariant,
} from "./agent-result.js";
import type { VariantEntry } from "./variations.js";

// ── normalizeAgentCharacters ────────────────────────────────────────

test("normalizeAgentCharacters maps bridge payloads", () => {
  const characters = normalizeAgentCharacters([
    { name: "Alice", description: "", static_features: "Long blonde hair." },
    { name: "  Bob  ", description: "Sturdy build.", dynamic_features: "Hat" },
  ]);

  assert.deepEqual(characters, [
    { name: "Alice", description: "Long blonde hair." },
    { name: "Bob", description: "Sturdy build." },
  ]);
});

test("normalizeAgentCharacters drops blank names and non-arrays", () => {
  assert.deepEqual(normalizeAgentCharacters([{ description: "no name" }]), []);
  assert.deepEqual(normalizeAgentCharacters(undefined), []);
  assert.deepEqual(normalizeAgentCharacters("oops"), []);
});

// ── normalizeAgentScenes ────────────────────────────────────────────

test("normalizeAgentScenes keeps scene order and trims empties", () => {
  const scenes = normalizeAgentScenes([
    { idx: 0, script: "<Jane> paces." },
    { idx: 1, script: "   " },
    { idx: 2, script: "<John> nods." },
  ]);

  assert.deepEqual(
    scenes.map((s) => s.idx),
    [0, 2],
  );
});

// ── pickBestVariant ─────────────────────────────────────────────────

const variants: VariantEntry[] = [
  { assetId: "a0", jobId: "j0", index: 0 },
  { assetId: "a1", jobId: "j1", index: 1 },
  { assetId: "a2", jobId: "j2", index: 2 },
];

test("pickBestVariant matches by entry index", () => {
  assert.equal(pickBestVariant(variants, 1)?.assetId, "a1");
});

test("pickBestVariant falls back to clamped position after cap eviction", () => {
  const evicted: VariantEntry[] = [
    { assetId: "a9", jobId: "j9", index: 9 },
    { assetId: "a10", jobId: "j10", index: 10 },
  ];
  assert.equal(pickBestVariant(evicted, 9)?.assetId, "a9");
  assert.equal(pickBestVariant(evicted, 99)?.assetId, "a10");
  assert.equal(pickBestVariant(undefined, 0), undefined);
});

// ── spawn graph builders ────────────────────────────────────────────

test("buildCharacterSpawnGraph lays out characters left of source", () => {
  const { nodes, edges, characterIds } = buildCharacterSpawnGraph(
    "script-1",
    { x: 500, y: 100 },
    [
      { name: "Alice", description: "A" },
      { name: "Bob", description: "B" },
    ],
  );

  assert.equal(nodes.length, 2);
  assert.deepEqual(characterIds, nodes.map((n) => n.id));
  assert.equal(nodes[0].position.x, 140);
  assert.equal(nodes[1].position.y, 280);
  assert.deepEqual(
    edges.map((e) => [e.sourceNodeId, e.targetNodeId]),
    [
      [nodes[0].id, "script-1"],
      [nodes[1].id, "script-1"],
    ],
  );
});

test("buildSceneSpawnGraph stacks scenes below source", () => {
  const { nodes, edges } = buildSceneSpawnGraph("novel-1", { x: 100, y: 50 }, [
    { idx: 0, script: "scene one" },
  ]);

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "script");
  assert.equal(nodes[0].data.content, "scene one");
  assert.deepEqual(edges, [
    { id: edges[0].id, sourceNodeId: "novel-1", targetNodeId: nodes[0].id, sourceHandle: null, targetHandle: null },
  ]);
});

// ── isAgentResultJob ────────────────────────────────────────────────

test("isAgentResultJob accepts result-bearing pipeline jobs only", () => {
  assert.ok(isAgentResultJob("pipeline.script2characters", { result: {} }));
  assert.equal(isAgentResultJob("pipeline.script2storyboard", { cells: [{}] }), false);
  assert.equal(isAgentResultJob("shot.first_frame", { result: {} }), false);
  assert.equal(isAgentResultJob("pipeline.plan_script", {}), false);
});
