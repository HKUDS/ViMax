import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasNodeType } from "@vimax/contracts";
import {
  collectDownstreamNodeIds,
  collectScriptChainNodeIds,
  diffIds,
  inferAutoEdges,
  isReadyToRun,
  pickByHandle,
  readyDirtyChildrenOf,
  readyDirtyNodes,
  normalizeCharacterAssets,
  resolveShotMode,
  resolveUpstreamInputs,
  subtractEdges,
  type CharacterAssetLike,
  type EdgeLike,
  type NodeRuntimeLike,
  type UpstreamNodeLike,
} from "./canvas-graph.js";

// ── diffIds ────────────────────────────────────────────────────────

test("diffIds returns existing ids missing from incoming, preserving order", () => {
  assert.deepEqual(diffIds(["a", "b", "c", "d"], ["b", "d"]), ["a", "c"]);
});

test("diffIds returns nothing when incoming is a superset", () => {
  assert.deepEqual(diffIds(["a"], ["a", "b"]), []);
});

test("diffIds returns the whole set when incoming is empty", () => {
  assert.deepEqual(diffIds(["a", "b"], []), ["a", "b"]);
});

test("diffIds ignores duplicates in incoming", () => {
  assert.deepEqual(diffIds(["a", "b"], ["b", "b", "b"]), ["a"]);
});

// ── collectDownstreamNodeIds ───────────────────────────────────────

const E = (
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): EdgeLike => ({ sourceNodeId: source, targetNodeId: target, sourceHandle, targetHandle });

test("collectDownstreamNodeIds walks a linear chain a -> b -> c", () => {
  const edges = [E("a", "b"), E("b", "c")];
  assert.deepEqual(collectDownstreamNodeIds(edges, "a"), ["b", "c"]);
});

test("collectDownstreamNodeIds is BFS ordered across a fan-out", () => {
  // a -> b, a -> c, b -> d, c -> d
  const edges = [E("a", "b"), E("a", "c"), E("b", "d"), E("c", "d")];
  assert.deepEqual(collectDownstreamNodeIds(edges, "a"), ["b", "c", "d"]);
});

test("collectDownstreamNodeIds terminates on cycles", () => {
  // a -> b -> c -> b (cycle back to b)
  const edges = [E("a", "b"), E("b", "c"), E("c", "b")];
  assert.deepEqual(collectDownstreamNodeIds(edges, "a"), ["b", "c"]);
});

test("collectDownstreamNodeIds excludes the start node", () => {
  const edges = [E("a", "b"), E("b", "a")];
  assert.deepEqual(collectDownstreamNodeIds(edges, "a"), ["b"]);
});

test("collectDownstreamNodeIds returns empty for a leaf node", () => {
  const edges = [E("a", "b"), E("b", "c")];
  assert.deepEqual(collectDownstreamNodeIds(edges, "c"), []);
});

test("collectScriptChainNodeIds isolates scripts and includes their inbound reference images", () => {
  const nodes = [
    { id: "script-a", type: "script" },
    { id: "cell-a", type: "storyboard_cell" },
    { id: "shot-a", type: "shot" },
    { id: "ref-a", type: "image", data: { referenceAssetIds: ["asset-a"] } },
    { id: "video-a", type: "video" },
    { id: "script-b", type: "script" },
    { id: "cell-b", type: "storyboard_cell" },
  ];
  const ids = collectScriptChainNodeIds(nodes, [
    E("script-a", "cell-a"),
    E("cell-a", "shot-a"),
    E("shot-a", "video-a"),
    E("ref-a", "video-a"),
    E("script-b", "cell-b"),
  ], "script-a");
  assert.deepEqual([...ids], ["script-a", "cell-a", "shot-a", "video-a", "ref-a"]);
});

test("collectDownstreamNodeIds ignores edges that do not touch the subgraph", () => {
  const edges = [E("a", "b"), E("x", "y")];
  assert.deepEqual(collectDownstreamNodeIds(edges, "a"), ["b"]);
});

// ── resolveUpstreamInputs ──────────────────────────────────────────

const N = (id: string, type: string, outputAssetId: string | null): UpstreamNodeLike => ({
  id,
  type,
  outputAssetId,
});

/** Build a node map from a list of node refs. */
const nodeMap = (...list: UpstreamNodeLike[]): Map<string, UpstreamNodeLike> =>
  new Map(list.map((n) => [n.id, n]));

test("resolveUpstreamInputs returns assets from edges targeting the node", () => {
  const nodes = nodeMap(
    N("img1", "image", "asset-1"),
    N("img2", "image", "asset-2"),
  );
  const edges = [
    E("img1", "shot", "output", "first_frame"),
    E("img2", "shot", "output", "last_frame"),
  ];
  const result = resolveUpstreamInputs(edges, nodes, "shot");
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    assetId: "asset-1",
    sourceNodeId: "img1",
    sourceHandle: "output",
    targetHandle: "first_frame",
    sourceNodeType: "image",
  });
  assert.deepEqual(result[1], {
    assetId: "asset-2",
    sourceNodeId: "img2",
    sourceHandle: "output",
    targetHandle: "last_frame",
    sourceNodeType: "image",
  });
});

test("resolveUpstreamInputs skips upstream nodes without an output asset", () => {
  const nodes = nodeMap(
    N("idle", "image", null),
    N("done", "image", "asset-1"),
  );
  const edges = [E("idle", "shot"), E("done", "shot")];
  const result = resolveUpstreamInputs(edges, nodes, "shot");
  assert.deepEqual(result.map((r) => r.assetId), ["asset-1"]);
});

test("resolveUpstreamInputs skips edges whose source node is unknown", () => {
  const nodes = nodeMap(N("done", "image", "asset-1"));
  const edges = [E("ghost", "shot"), E("done", "shot")];
  const result = resolveUpstreamInputs(edges, nodes, "shot");
  assert.deepEqual(result.map((r) => r.assetId), ["asset-1"]);
});

test("resolveUpstreamInputs nulls handles when the edge omits them", () => {
  const nodes = nodeMap(N("img", "image", "asset-1"));
  const edges = [E("img", "shot")];
  const result = resolveUpstreamInputs(edges, nodes, "shot");
  assert.equal(result[0]!.sourceHandle, null);
  assert.equal(result[0]!.targetHandle, null);
});

test("resolveUpstreamInputs returns nothing for a node with no incoming edges", () => {
  const nodes = nodeMap(N("img", "image", "asset-1"));
  const edges = [E("shot", "video")];
  assert.deepEqual(resolveUpstreamInputs(edges, nodes, "shot"), []);
});

// ── pickByHandle ───────────────────────────────────────────────────

test("pickByHandle returns the asset bound to the given target handle", () => {
  const inputs = [
    { assetId: "ff", sourceNodeId: "n1", sourceHandle: "output", targetHandle: "first_frame", sourceNodeType: "image" },
    { assetId: "lf", sourceNodeId: "n2", sourceHandle: "output", targetHandle: "last_frame", sourceNodeType: "image" },
  ];
  assert.equal(pickByHandle(inputs, "first_frame"), "ff");
  assert.equal(pickByHandle(inputs, "last_frame"), "lf");
});

test("pickByHandle returns null when no input carries the handle", () => {
  const inputs = [
    { assetId: "ff", sourceNodeId: "n1", sourceHandle: "output", targetHandle: "first_frame", sourceNodeType: "image" },
  ];
  assert.equal(pickByHandle(inputs, "last_frame"), null);
  assert.equal(pickByHandle([], "first_frame"), null);
});

test("pickByHandle returns the first match when handles collide", () => {
  const inputs = [
    { assetId: "a", sourceNodeId: "n3", sourceHandle: "output", targetHandle: "reference", sourceNodeType: "image" },
    { assetId: "b", sourceNodeId: "n4", sourceHandle: "output", targetHandle: "reference", sourceNodeType: "image" },
  ];
  assert.equal(pickByHandle(inputs, "reference"), "a");
});

// ── isReadyToRun ───────────────────────────────────────────────────

const R = (id: string, status: string, type: string): NodeRuntimeLike => ({ id, status, type });
const runtimeMap = (...list: NodeRuntimeLike[]): Map<string, NodeRuntimeLike> =>
  new Map(list.map((n) => [n.id, n]));

test("isReadyToRun is true for a node with no runnable upstream", () => {
  const nodes = runtimeMap(R("img", "idle", "image"));
  assert.equal(isReadyToRun("img", [], nodes), true);
});

test("isReadyToRun requires every runnable upstream to be done", () => {
  const nodes = runtimeMap(
    R("a", "done", "image"),
    R("b", "running", "image"),
    R("c", "idle", "video"),
  );
  const edges = [E("a", "c"), E("b", "c")];
  assert.equal(isReadyToRun("c", edges, nodes), false);
});

test("isReadyToRun is true once all runnable upstreams are done", () => {
  const nodes = runtimeMap(
    R("a", "done", "image"),
    R("b", "done", "image"),
    R("c", "dirty", "video"),
  );
  const edges = [E("a", "c"), E("b", "c")];
  assert.equal(isReadyToRun("c", edges, nodes), true);
});

test("isReadyToRun ignores non-runnable upstream (script/storyboard)", () => {
  // script is connected but never runs — it must not block the character node.
  const nodes = runtimeMap(
    R("script", "idle", "script"),
    R("cell", "idle", "storyboard_cell"),
    R("char", "dirty", "character"),
  );
  const edges = [E("script", "char"), E("cell", "char")];
  assert.equal(isReadyToRun("char", edges, nodes), true);
});

test("isReadyToRun ignores edges from unknown source nodes", () => {
  const nodes = runtimeMap(R("c", "dirty", "image"));
  const edges = [E("ghost", "c")];
  assert.equal(isReadyToRun("c", edges, nodes), true);
});

// ── readyDirtyChildrenOf ───────────────────────────────────────────

test("readyDirtyChildrenOf returns ready dirty direct children of the completed node", () => {
  const nodes = runtimeMap(
    R("shot", "done", "shot"),     // just completed
    R("img1", "dirty", "image"),   // dirty child, all upstreams done → ready
    R("img2", "dirty", "image"),   // dirty child, but other upstream idle → not ready
    R("vid", "dirty", "video"),    // dirty descendant, not a direct child
    R("other", "idle", "image"),   // child but not dirty
  );
  const edges = [
    E("shot", "img1"),
    E("shot", "img2"),
    E("x", "img2"),       // img2 has another upstream
    E("img1", "vid"),     // vid is a grandchild
    E("shot", "other"),
  ];
  const nodesWithX = runtimeMap(
    R("shot", "done", "shot"),
    R("img1", "dirty", "image"),
    R("img2", "dirty", "image"),
    R("vid", "dirty", "video"),
    R("other", "idle", "image"),
    R("x", "idle", "image"),
  );
  assert.deepEqual(readyDirtyChildrenOf(edges, nodesWithX, "shot"), ["img1"]);
});

test("readyDirtyChildrenOf dedupes when multiple edges hit the same child", () => {
  const nodes = runtimeMap(
    R("shot", "done", "shot"),
    R("img", "dirty", "image"),
  );
  const edges = [E("shot", "img"), E("shot", "img")];
  assert.deepEqual(readyDirtyChildrenOf(edges, nodes, "shot"), ["img"]);
});

test("readyDirtyChildrenOf returns empty when no dirty child is ready", () => {
  const nodes = runtimeMap(
    R("shot", "done", "shot"),
    R("img", "done", "image"),  // child done, not dirty
  );
  const edges = [E("shot", "img")];
  assert.deepEqual(readyDirtyChildrenOf(edges, nodes, "shot"), []);
});

// ── readyDirtyNodes ────────────────────────────────────────────────

test("readyDirtyNodes returns all dirty nodes whose upstreams are done", () => {
  const nodes = runtimeMap(
    R("a", "done", "image"),
    R("b", "dirty", "image"),   // ready (no upstream)
    R("c", "dirty", "video"),   // ready (upstream a done)
    R("d", "dirty", "video"),   // not ready (upstream e idle)
    R("e", "idle", "image"),
    R("f", "done", "image"),    // not dirty
  );
  const edges = [E("a", "c"), E("e", "d")];
  const result = readyDirtyNodes(edges, nodes);
  assert.ok(result.includes("b"));
  assert.ok(result.includes("c"));
  assert.ok(!result.includes("d"));
  assert.ok(!result.includes("f"));
  assert.equal(result.length, 2);
});

test("readyDirtyNodes returns empty when nothing is dirty", () => {
  const nodes = runtimeMap(R("a", "done", "image"), R("b", "idle", "image"));
  assert.deepEqual(readyDirtyNodes([E("a", "b")], nodes), []);
});

// ── inferAutoEdges ─────────────────────────────────────────────────

const AW = (id: string, type: CanvasNodeType) => ({ id, type });
let _counter = 0;
const genId = () => `e${_counter++}`;

function pairs(edges: { sourceNodeId: string; targetNodeId: string; sourceHandle: string | null; targetHandle: string | null }[]) {
  return edges.map((e) => [e.sourceNodeId, e.targetNodeId, e.sourceHandle, e.targetHandle]);
}

test("inferAutoEdges wires a full linear pipeline", () => {
  _counter = 0;
  const edges = inferAutoEdges(
    [AW("s", "script"), AW("cell", "storyboard_cell"), AW("shot", "shot"), AW("img", "image"), AW("vid", "video"), AW("cc", "concat")],
    genId,
  );
  assert.deepEqual(pairs(edges), [
    ["s", "cell", null, "reference"],
    ["cell", "shot", "output", "reference"],
    ["shot", "img", "first_frame", "reference"],
    ["img", "vid", "output", "first_frame"],
    ["vid", "cc", "output", "input"],
  ]);
});

test("inferAutoEdges leaves a script isolated when it has no cell/character successor", () => {
  _counter = 0;
  const edges = inferAutoEdges(
    [AW("s", "script"), AW("shot", "shot"), AW("img", "image"), AW("vid", "video"), AW("cc", "concat")],
    genId,
  );
  // script's only successors are storyboard_cell/character — absent here.
  assert.deepEqual(pairs(edges), [
    ["shot", "img", "first_frame", "reference"],
    ["img", "vid", "output", "first_frame"],
    ["vid", "cc", "output", "input"],
  ]);
});

test("inferAutoEdges fans a script out to all storyboard cells", () => {
  _counter = 0;
  const edges = inferAutoEdges(
    [AW("s", "script"), AW("c1", "storyboard_cell"), AW("c2", "storyboard_cell"), AW("c3", "storyboard_cell")],
    genId,
  );
  assert.deepEqual(pairs(edges), [
    ["s", "c1", null, "reference"],
    ["s", "c2", null, "reference"],
    ["s", "c3", null, "reference"],
  ]);
});

test("inferAutoEdges fans a character out to all shots", () => {
  _counter = 0;
  const edges = inferAutoEdges(
    [AW("hero", "character"), AW("sh1", "shot"), AW("sh2", "shot")],
    genId,
  );
  assert.deepEqual(pairs(edges), [
    ["hero", "sh1", "output", "reference"],
    ["hero", "sh2", "output", "reference"],
  ]);
});

test("inferAutoEdges pairs shots to images by index", () => {
  _counter = 0;
  const edges = inferAutoEdges(
    [AW("sh1", "shot"), AW("sh2", "shot"), AW("im1", "image"), AW("im2", "image")],
    genId,
  );
  assert.deepEqual(pairs(edges), [
    ["sh1", "im1", "first_frame", "reference"],
    ["sh2", "im2", "first_frame", "reference"],
  ]);
});

test("inferAutoEdges leaves surplus sources dangling instead of double-feeding a target", () => {
  // 3 shots, 1 image → only the first shot feeds it; 一个目标不接两条同类输入
  _counter = 0;
  const edges = inferAutoEdges(
    [AW("sh1", "shot"), AW("sh2", "shot"), AW("sh3", "shot"), AW("im1", "image")],
    genId,
  );
  assert.deepEqual(pairs(edges), [
    ["sh1", "im1", "first_frame", "reference"],
  ]);
});

test("inferAutoEdges never re-wires nodes already connected by the same rule (storyboard-retry regression)", () => {
  // 分镜重跑后的典型现场：旧链 2 video 已各自接好 image，新链 3 张 image。
  // 折叠配对曾把新 image 再接到旧 video 上（重复 first_frame 边）。
  _counter = 0;
  const nodes = [
    AW("v1-old", "video"), AW("v2-old", "video"),
    AW("i1-old", "image"), AW("i2-old", "image"),
    AW("i1-new", "image"), AW("i2-new", "image"), AW("i3-new", "image"),
  ];
  const existing = [
    { sourceNodeId: "i1-old", targetNodeId: "v1-old", sourceHandle: "output", targetHandle: "first_frame" },
    { sourceNodeId: "i2-old", targetNodeId: "v2-old", sourceHandle: "output", targetHandle: "first_frame" },
  ];
  const edges = inferAutoEdges(nodes, genId, existing);
  const imgToVid = pairs(edges).filter(([s, t]) => s!.startsWith("i") && t!.startsWith("v"));
  assert.deepEqual(imgToVid, []);
});

test("inferAutoEdges pairs only the untaken source with an untaken target", () => {
  // i1 已接 v1；剩 i2/i3 与 v2 → 只有按序的第一个 i2 接入，i3 悬空等待自己的 video
  _counter = 0;
  const nodes = [
    AW("v1", "video"), AW("v2", "video"),
    AW("i1", "image"), AW("i2", "image"), AW("i3", "image"),
  ];
  const existing = [
    { sourceNodeId: "i1", targetNodeId: "v1", sourceHandle: "output", targetHandle: "first_frame" },
  ];
  const edges = inferAutoEdges(nodes, genId, existing);
  const imgToVid = pairs(edges).filter(([s, t]) => s!.startsWith("i") && t!.startsWith("v"));
  assert.deepEqual(imgToVid, [
    ["i2", "v2", "output", "first_frame"],
  ]);
});

test("inferAutoEdges folds surplus targets onto the last source", () => {
  // 1 shot, 3 images → shot1 feeds all three
  _counter = 0;
  const edges = inferAutoEdges(
    [AW("sh1", "shot"), AW("im1", "image"), AW("im2", "image"), AW("im3", "image")],
    genId,
  );
  assert.deepEqual(pairs(edges), [
    ["sh1", "im1", "first_frame", "reference"],
    ["sh1", "im2", "first_frame", "reference"],
    ["sh1", "im3", "first_frame", "reference"],
  ]);
});

test("inferAutoEdges assigns a unique id per edge", () => {
  const edges = inferAutoEdges(
    [AW("s", "script"), AW("c1", "storyboard_cell"), AW("c2", "storyboard_cell")],
    genId,
  );
  assert.equal(new Set(edges.map((e) => e.id)).size, edges.length);
});

test("inferAutoEdges returns nothing when no dependency relates the nodes", () => {
  _counter = 0;
  const edges = inferAutoEdges([AW("a", "concat"), AW("b", "concat")], genId);
  assert.deepEqual(edges, []);
});

test("inferAutoEdges ignores types with no successor present", () => {
  // only videos, no concat → no edges
  _counter = 0;
  const edges = inferAutoEdges([AW("v1", "video"), AW("v2", "video")], genId);
  assert.deepEqual(edges, []);
});

test("inferAutoEdges keeps node order within a type stable", () => {
  _counter = 0;
  const edges = inferAutoEdges(
    [AW("sh2", "shot"), AW("sh1", "shot"), AW("im1", "image"), AW("im2", "image")],
    genId,
  );
  // input order preserved: sh2→im1, sh1→im2
  assert.deepEqual(pairs(edges), [
    ["sh2", "im1", "first_frame", "reference"],
    ["sh1", "im2", "first_frame", "reference"],
  ]);
});

// ── subtractEdges ──────────────────────────────────────────────────

test("subtractEdges drops candidates already present (by signature)", () => {
  const existing: EdgeLike[] = [
    { sourceNodeId: "a", targetNodeId: "b", sourceHandle: "output", targetHandle: "first_frame" },
  ];
  const candidates: EdgeLike[] = [
    { sourceNodeId: "a", targetNodeId: "b", sourceHandle: "output", targetHandle: "first_frame" }, // dup
    { sourceNodeId: "a", targetNodeId: "c", sourceHandle: "output", targetHandle: "first_frame" }, // new
  ];
  const result = subtractEdges(candidates, existing);
  assert.deepEqual(
    result.map((e) => e.targetNodeId),
    ["c"],
  );
});

test("subtractEdges also de-duplicates within candidates", () => {
  const candidates: EdgeLike[] = [
    { sourceNodeId: "a", targetNodeId: "b", sourceHandle: null, targetHandle: null },
    { sourceNodeId: "a", targetNodeId: "b", sourceHandle: null, targetHandle: null },
  ];
  assert.equal(subtractEdges(candidates, []).length, 1);
});

test("subtractEdges treats null and undefined handles as equal", () => {
  const existing: EdgeLike[] = [
    { sourceNodeId: "a", targetNodeId: "b", sourceHandle: null, targetHandle: null },
  ];
  const candidates: EdgeLike[] = [
    { sourceNodeId: "a", targetNodeId: "b", sourceHandle: undefined, targetHandle: undefined },
  ];
  assert.equal(subtractEdges(candidates, existing).length, 0);
});

test("subtractEdges returns everything when nothing exists", () => {
  const candidates: EdgeLike[] = [
    { sourceNodeId: "a", targetNodeId: "b" },
    { sourceNodeId: "b", targetNodeId: "c" },
  ];
  assert.equal(subtractEdges(candidates, []).length, 2);
});

// ── resolveShotMode ─────────────────────────────────────────────────

test("resolveShotMode forces t2i for large variation even with a reference", () => {
  const d = resolveShotMode("large", true);
  assert.equal(d.mode, "t2i");
  assert.ok(d.promptSuffix.length > 0);
});

test("resolveShotMode uses t2i for large variation without a reference", () => {
  const d = resolveShotMode("large", false);
  assert.equal(d.mode, "t2i");
  assert.ok(d.promptSuffix.length > 0);
});

test("resolveShotMode uses i2i for small variation with a reference", () => {
  const d = resolveShotMode("small", true);
  assert.equal(d.mode, "i2i");
  assert.ok(d.promptSuffix.length > 0);
});

test("resolveShotMode uses i2i for medium variation with a reference", () => {
  const d = resolveShotMode("medium", true);
  assert.equal(d.mode, "i2i");
  assert.ok(d.promptSuffix.length > 0);
});

test("resolveShotMode falls back to t2i for small variation without a reference", () => {
  const d = resolveShotMode("small", false);
  assert.equal(d.mode, "t2i");
  assert.equal(d.promptSuffix, "");
});

test("resolveShotMode defaults to t2i when variation type is absent (legacy nodes)", () => {
  const d = resolveShotMode(undefined, false);
  assert.equal(d.mode, "t2i");
  assert.equal(d.promptSuffix, "");
});

// ── normalizeCharacterAssets ───────────────────────────────────────

const CH = (
  id: string,
  outputAssetId: string | null,
  frontAssetId?: string,
): CharacterAssetLike => ({
  id,
  outputAssetId,
  data: frontAssetId ? { frontAssetId } : {},
});

test("normalizeCharacterAssets prefers frontAssetId over outputAssetId", () => {
  assert.deepEqual(
    normalizeCharacterAssets([CH("c1", "out-1", "front-1")]),
    ["front-1"],
  );
});

test("normalizeCharacterAssets falls back to outputAssetId when no front portrait", () => {
  assert.deepEqual(
    normalizeCharacterAssets([CH("c1", "out-1")]),
    ["out-1"],
  );
});

test("normalizeCharacterAssets skips characters with no portrait at all", () => {
  assert.deepEqual(
    normalizeCharacterAssets([CH("c1", null), CH("c2", null)]),
    [],
  );
});

test("normalizeCharacterAssets collects portraits from multiple characters in order", () => {
  assert.deepEqual(
    normalizeCharacterAssets([
      CH("c1", null, "f1"),
      CH("c2", "o2"),
      CH("c3", null),
    ]),
    ["f1", "o2"],
  );
});
