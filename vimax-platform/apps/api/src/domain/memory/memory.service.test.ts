import assert from "node:assert/strict";
import test from "node:test";
import { mergeProfileFacts, type ProfileFact } from "./memory.service.js";

function fact(key: string, value: string, updatedAt = "2026-01-01T00:00:00.000Z"): ProfileFact {
  return { key, value, updatedAt };
}

test("mergeProfileFacts dedupes by key with incoming overriding existing", () => {
  const merged = mergeProfileFacts(
    [fact("行业", "美妆"), fact("风格", "极简")],
    [fact("行业", "母婴"), fact("预算", "中高")],
  );
  const byKey = new Map(merged.map((f) => [f.key, f.value]));
  assert.equal(byKey.get("行业"), "母婴");
  assert.equal(byKey.get("风格"), "极简");
  assert.equal(byKey.get("预算"), "中高");
  assert.equal(merged.length, 3);
});

test("mergeProfileFacts stamps updatedAt on touched facts only", () => {
  const merged = mergeProfileFacts(
    [fact("风格", "极简")],
    [fact("行业", "美妆")],
  );
  const byKey = new Map(merged.map((f) => [f.key, f]));
  // 被覆盖/新增的事实拿到新的 updatedAt
  assert.ok(byKey.get("行业")!.updatedAt > "2026-01-01");
  // 未触碰的事实保留原 updatedAt
  assert.equal(byKey.get("风格")!.updatedAt, "2026-01-01T00:00:00.000Z");
});

test("mergeProfileFacts handles empty inputs", () => {
  assert.deepEqual(mergeProfileFacts([], []), []);
  const onlyExisting = mergeProfileFacts([fact("a", "b")], []);
  assert.equal(onlyExisting.length, 1);
  const onlyIncoming = mergeProfileFacts([], [fact("a", "b")]);
  assert.equal(onlyIncoming.length, 1);
});
