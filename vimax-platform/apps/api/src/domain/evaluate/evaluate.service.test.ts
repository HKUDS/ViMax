import assert from "node:assert/strict";
import test from "node:test";
import type { ImageEvaluation } from "@vimax/contracts";
import {
  buildRefinePrompt,
  EVALUATE_WEIGHTS,
  shouldAutoRefine,
  weightedOverall,
} from "./evaluate.service.js";

function evaluation(overall: number): ImageEvaluation {
  return { overall, dimensions: { fidelity: overall, text: overall, aesthetics: overall, compliance: overall } };
}

test("EVALUATE_WEIGHTS sum to 1", () => {
  const sum = Object.values(EVALUATE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 1);
});

test("weightedOverall all ones gives 1", () => {
  assert.equal(weightedOverall({ fidelity: 1, text: 1, aesthetics: 1, compliance: 1 }), 1);
});

test("weightedOverall keeps 3 decimals", () => {
  assert.equal(
    weightedOverall({ fidelity: 0.33333, text: 0.5, aesthetics: 0.7, compliance: 0.9 }),
    Number((0.33333 * 0.4 + 0.5 * 0.2 + 0.7 * 0.2 + 0.9 * 0.2).toFixed(3)),
  );
});

test("shouldAutoRefine refines on low score first attempt", () => {
  const result = shouldAutoRefine({ evaluation: evaluation(0.4), attempt: 0 });
  assert.equal(result.refine, true);
});

test("shouldAutoRefine stops after one attempt", () => {
  const result = shouldAutoRefine({ evaluation: evaluation(0.4), attempt: 1 });
  assert.equal(result.refine, false);
});

test("shouldAutoRefine skips high scores", () => {
  const result = shouldAutoRefine({ evaluation: evaluation(0.6), attempt: 0 });
  assert.equal(result.refine, false);
});

test("buildRefinePrompt keeps original and appends critique", () => {
  const prompt = buildRefinePrompt("红色运动鞋白底图", "鞋带结构畸形");
  assert.match(prompt, /^红色运动鞋白底图/);
  assert.match(prompt, /改进要求：鞋带结构畸形；保持商品主体与构图不变$/);
});
