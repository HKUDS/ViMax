import test from "node:test";
import assert from "node:assert/strict";
import { parseOffloadedInputError } from "./restore-from-local.js";

test("parseOffloadedInputError: 单个资产 id", () => {
  assert.deepEqual(
    parseOffloadedInputError("asset.input_offloaded:4162179d-c35b-4174-9f23-6b4a3e1339d4"),
    ["4162179d-c35b-4174-9f23-6b4a3e1339d4"],
  );
});

test("parseOffloadedInputError: 多个资产 id", () => {
  assert.deepEqual(
    parseOffloadedInputError("asset.input_offloaded:aaa, bbb"),
    ["aaa", "bbb"],
  );
});

test("parseOffloadedInputError: 其他错误返回 null", () => {
  assert.equal(parseOffloadedInputError("provider.invalid_key"), null);
  assert.equal(parseOffloadedInputError("canvas.video_needs_upstream_frames"), null);
  assert.equal(parseOffloadedInputError("asset.input_offloaded:"), null);
});
