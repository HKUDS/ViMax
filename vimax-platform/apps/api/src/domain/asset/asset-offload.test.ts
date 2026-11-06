import test from "node:test";
import assert from "node:assert/strict";
import { resolveOffloadPolicy } from "./asset-offload.js";

test("resolveOffloadPolicy: generated 且未 offload → 执行删除", () => {
  assert.deepEqual(
    resolveOffloadPolicy({ source: "generated", offloadedAt: null }),
    { action: "offload" },
  );
});

test("resolveOffloadPolicy: 已 offload → 幂等跳过", () => {
  assert.deepEqual(
    resolveOffloadPolicy({ source: "generated", offloadedAt: new Date() }),
    { action: "skip", reason: "already_offloaded" },
  );
});

test("resolveOffloadPolicy: 用户手动上云的资产受保护", () => {
  assert.deepEqual(
    resolveOffloadPolicy({ source: "upload", offloadedAt: null }),
    { action: "skip", reason: "upload_protected" },
  );
});

test("resolveOffloadPolicy: 下游节点未完成 → 跳过删除（管线还要读这个二进制）", () => {
  assert.deepEqual(
    resolveOffloadPolicy({ source: "generated", offloadedAt: null }, true),
    { action: "skip", reason: "downstream_pending" },
  );
});

test("resolveOffloadPolicy: 下游全部完成 → 正常删除", () => {
  assert.deepEqual(
    resolveOffloadPolicy({ source: "generated", offloadedAt: null }, false),
    { action: "offload" },
  );
});
