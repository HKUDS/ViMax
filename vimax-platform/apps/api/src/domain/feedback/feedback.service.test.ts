import assert from "node:assert/strict";
import test from "node:test";
import { FEEDBACK_SIGNALS, normalizeFeedbackSignal, signalToScore } from "./feedback.service.js";

test("normalizeFeedbackSignal accepts known signals", () => {
  for (const signal of FEEDBACK_SIGNALS) {
    assert.equal(normalizeFeedbackSignal(signal), signal);
  }
});

test("normalizeFeedbackSignal rejects unknown signals", () => {
  assert.equal(normalizeFeedbackSignal("love"), null);
  assert.equal(normalizeFeedbackSignal(""), null);
});

test("signalToScore maps positive signals to 1", () => {
  assert.equal(signalToScore("pick"), 1);
  assert.equal(signalToScore("download"), 1);
  assert.equal(signalToScore("thumb_up"), 1);
});

test("signalToScore maps retry to 0.5 and negatives to 0", () => {
  assert.equal(signalToScore("retry"), 0.5);
  assert.equal(signalToScore("discard"), 0);
  assert.equal(signalToScore("thumb_down"), 0);
});
