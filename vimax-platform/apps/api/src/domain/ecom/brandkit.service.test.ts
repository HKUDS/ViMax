import assert from "node:assert/strict";
import test from "node:test";
import { brandKitToConstraints } from "./brandkit.service.js";

test("brandKitToConstraints returns empty string for an empty kit", () => {
  assert.equal(brandKitToConstraints({}), "");
  assert.equal(brandKitToConstraints({ slogan: "  " }), "");
  assert.equal(brandKitToConstraints({ colors: [], fonts: [] }), "");
});

test("brandKitToConstraints renders all sections", () => {
  const text = brandKitToConstraints({
    colors: [
      { hex: "#FF0000", usage: "主色" },
      { hex: "#00FF00" },
    ],
    fonts: ["Montserrat", "思源黑体"],
    slogan: "Just Do It",
    bannedWords: ["最低价", "第一"],
  });
  assert.ok(text.includes("品牌色：#FF0000(主色)、#00FF00"));
  assert.ok(text.includes("字体：Montserrat、思源黑体"));
  assert.ok(text.includes("口号：Just Do It"));
  assert.ok(text.includes("画面避免出现：最低价、第一"));
  // 分段以中文分号连接
  assert.equal(text.split("；").length, 4);
});

test("brandKitToConstraints skips empty sections", () => {
  const text = brandKitToConstraints({ slogan: "轻若羽翼" });
  assert.equal(text, "口号：轻若羽翼");
});

test("brandKitToConstraints tolerates non-array jsonb payloads", () => {
  assert.equal(brandKitToConstraints({ colors: "not-an-array" }), "");
  assert.equal(brandKitToConstraints({ fonts: null }), "");
});
