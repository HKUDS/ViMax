import assert from "node:assert/strict";
import test from "node:test";
import { buildNodeStatusMessage } from "./node-status.js";

test("buildNodeStatusMessage includes the core fields", () => {
  const msg = buildNodeStatusMessage({
    canvasId: "c1", nodeId: "n1", status: "running",
  });
  assert.deepEqual(msg, {
    type: "canvas.node_status",
    canvasId: "c1",
    nodeId: "n1",
    status: "running",
  });
});

test("buildNodeStatusMessage omits optional fields when not provided", () => {
  const msg = buildNodeStatusMessage({
    canvasId: "c1", nodeId: "n1", status: "idle",
  });
  assert.equal("outputAssetId" in msg, false);
  assert.equal("jobId" in msg, false);
});

test("buildNodeStatusMessage carries outputAssetId and jobId when provided", () => {
  const msg = buildNodeStatusMessage({
    canvasId: "c1", nodeId: "n1", status: "done",
    outputAssetId: "asset-1", jobId: "job-1",
  });
  assert.equal(msg.outputAssetId, "asset-1");
  assert.equal(msg.jobId, "job-1");
});

test("buildNodeStatusMessage allows null outputAssetId (e.g. a failed run)", () => {
  const msg = buildNodeStatusMessage({
    canvasId: "c1", nodeId: "n1", status: "failed",
    outputAssetId: null,
  });
  assert.equal(msg.outputAssetId, null);
});
