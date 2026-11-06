import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKFLOW_TEMPLATES,
  getTemplateById,
  instantiateTemplate,
  summarizeTemplate,
  type WorkflowTemplate,
} from "./workflow-templates.js";

// A minimal fixture for deterministic assertions.
const FIXTURE: WorkflowTemplate = {
  id: "fix",
  name: "fixture",
  description: "d",
  category: "general",
  nodes: [
    { id: "a", type: "image", position: { x: 10, y: 20 }, data: { prompt: "p1" }, label: "A" },
    { id: "b", type: "video", position: { x: 30, y: 40 }, data: { motionPreset: "zoom_in" }, label: "B" },
  ],
  edges: [
    { id: "e1", source: "a", target: "b", sourceHandle: "output", targetHandle: "first_frame" },
  ],
};

// deterministic id generator: n0, n1, n2, ...
const counter = () => {
  let i = 0;
  return () => `id${i++}`;
};

test("instantiateTemplate assigns fresh ids to nodes and edges", () => {
  const { nodes, edges } = instantiateTemplate(FIXTURE, { idGenerator: counter() });
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 1);
  const nodeIds = nodes.map((n) => n.id);
  assert.equal(new Set(nodeIds).size, 2, "node ids are unique");
  assert.ok(edges[0]!.id.startsWith("id"));
});

test("instantiateTemplate rewires edges to the new node ids", () => {
  const gen = counter();
  const { nodes, edges } = instantiateTemplate(FIXTURE, { idGenerator: gen });
  const [a, b] = nodes;
  assert.equal(edges[0]!.source, a!.id);
  assert.equal(edges[0]!.target, b!.id);
  assert.equal(edges[0]!.sourceHandle, "output");
  assert.equal(edges[0]!.targetHandle, "first_frame");
});

test("instantiateTemplate preserves node type, position, and data", () => {
  const { nodes } = instantiateTemplate(FIXTURE, { idGenerator: counter() });
  const [a, b] = nodes;
  assert.equal(a!.type, "image");
  assert.deepEqual(a!.position, { x: 10, y: 20 });
  assert.equal(a!.data.prompt, "p1");
  assert.equal(b!.type, "video");
  assert.equal(b!.data.motionPreset, "zoom_in");
});

test("instantiateTemplate applies the offset to every node position", () => {
  const { nodes } = instantiateTemplate(FIXTURE, {
    idGenerator: counter(),
    offset: { x: 100, y: 200 },
  });
  assert.deepEqual(nodes[0]!.position, { x: 110, y: 220 });
  assert.deepEqual(nodes[1]!.position, { x: 130, y: 240 });
});

test("instantiateTemplate clones node data so the template is not mutated", () => {
  const { nodes } = instantiateTemplate(FIXTURE, { idGenerator: counter() });
  nodes[0]!.data.prompt = "mutated";
  // original template data is untouched
  assert.equal(FIXTURE.nodes[0]!.data.prompt, "p1");
});

test("instantiateTemplate default id generator produces unique uuids", () => {
  const { nodes } = instantiateTemplate(FIXTURE);
  assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length);
  for (const n of nodes) {
    assert.match(n.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
});

// ── seed templates ─────────────────────────────────────────────────

test("every seed template has nodes, valid edges, and a stable id", () => {
  const ids = new Set<string>();
  for (const t of WORKFLOW_TEMPLATES) {
    assert.ok(!ids.has(t.id), `duplicate template id: ${t.id}`);
    ids.add(t.id);
    assert.ok(t.nodes.length >= 2, `${t.id} should have >= 2 nodes`);
    const nodeIds = new Set(t.nodes.map((n) => n.id));
    for (const e of t.edges) {
      assert.ok(nodeIds.has(e.source), `${t.id} edge ${e.id} source missing`);
      assert.ok(nodeIds.has(e.target), `${t.id} edge ${e.id} target missing`);
    }
  }
});

test("getTemplateById finds a seed template and returns undefined otherwise", () => {
  assert.ok(getTemplateById("ecommerce-product-scene"));
  assert.equal(getTemplateById("does-not-exist"), undefined);
});

test("summarizeTemplate reports node count and metadata without the graph", () => {
  const t = WORKFLOW_TEMPLATES[0]!;
  const s = summarizeTemplate(t);
  assert.equal(s.id, t.id);
  assert.equal(s.name, t.name);
  assert.equal(s.nodeCount, t.nodes.length);
  assert.equal("nodes" in s, false);
  assert.equal("edges" in s, false);
});

test("each seed template instantiates to a valid connected graph", () => {
  for (const t of WORKFLOW_TEMPLATES) {
    const { nodes, edges } = instantiateTemplate(t, { idGenerator: counter() });
    const ids = new Set(nodes.map((n) => n.id));
    assert.equal(nodes.length, t.nodes.length);
    assert.equal(edges.length, t.edges.length);
    for (const e of edges) {
      assert.ok(ids.has(e.source), `${t.id}: edge source not in instantiated nodes`);
      assert.ok(ids.has(e.target), `${t.id}: edge target not in instantiated nodes`);
    }
  }
});
