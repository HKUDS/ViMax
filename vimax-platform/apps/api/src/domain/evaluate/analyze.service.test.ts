import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyzeMessages, parseAnalyzeResult } from "./analyze.service.js";

test("buildAnalyzeMessages describe has system + 2 user parts", () => {
  const messages = buildAnalyzeMessages("describe", "data:image/png;base64,AAA");
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.role, "system");
  const user = messages[1]!;
  assert.equal(user.role, "user");
  const parts = user.content as Array<{ type: string }>;
  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.type, "text");
  assert.equal(parts[1]!.type, "image_url");
});

test("buildAnalyzeMessages product_fidelity appends reference image", () => {
  const messages = buildAnalyzeMessages(
    "product_fidelity",
    "data:image/png;base64,GEN",
    "data:image/png;base64,REF",
  );
  const parts = messages[1]!.content as Array<{ type: string; text?: string }>;
  assert.equal(parts.length, 3);
  assert.equal(parts[1]!.type, "image_url");
  assert.equal(parts[2]!.type, "image_url");
  assert.match(parts[0]!.text ?? "", /product_fidelity/);
});

test("buildAnalyzeMessages qc without reference has no fidelity key", () => {
  const messages = buildAnalyzeMessages("qc", "data:image/png;base64,AAA");
  const parts = messages[1]!.content as Array<{ type: string; text?: string }>;
  assert.equal(parts.length, 2);
  assert.doesNotMatch(parts[0]!.text ?? "", /product_fidelity/);
});

test("parseAnalyzeResult reads plain JSON", () => {
  const result = parseAnalyzeResult('{"description": "白底商品图", "issues": ["边缘毛糙"], "product_fidelity": 0.9}');
  assert.equal(result.description, "白底商品图");
  assert.deepEqual(result.issues, ["边缘毛糙"]);
  assert.equal(result.productFidelity, 0.9);
});

test("parseAnalyzeResult tolerates json fences", () => {
  const result = parseAnalyzeResult('```json\n{"description": "d", "issues": []}\n```');
  assert.equal(result.description, "d");
  assert.deepEqual(result.issues, []);
  assert.equal(result.productFidelity, undefined);
});

test("parseAnalyzeResult throws on bad JSON", () => {
  assert.throws(() => parseAnalyzeResult("这不是 JSON"), /JSON|analyze/);
});
