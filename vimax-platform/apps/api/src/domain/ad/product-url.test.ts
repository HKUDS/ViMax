import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicHttpUrl,
  parseProductHtml,
} from "./product-url.js";

// ── SSRF guards ─────────────────────────────────────────────────────

test("assertPublicHttpUrl accepts public https URLs", () => {
  const url = assertPublicHttpUrl("https://shop.example.com/product/123");
  assert.equal(url.hostname, "shop.example.com");
});

test("assertPublicHttpUrl rejects non-http protocols", () => {
  assert.throws(() => assertPublicHttpUrl("file:///etc/passwd"), /protocol_not_allowed/);
  assert.throws(() => assertPublicHttpUrl("ftp://example.com/x"), /protocol_not_allowed/);
});

test("assertPublicHttpUrl rejects private and loopback addresses", () => {
  assert.throws(() => assertPublicHttpUrl("http://127.0.0.1/x"), /private_address/);
  assert.throws(() => assertPublicHttpUrl("http://10.0.0.1/x"), /private_address/);
  assert.throws(() => assertPublicHttpUrl("http://192.168.1.1/x"), /private_address/);
  assert.throws(() => assertPublicHttpUrl("http://172.16.0.9/x"), /private_address/);
  assert.throws(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data"), /private_address/);
  assert.throws(() => assertPublicHttpUrl("http://localhost/x"), /private_address/);
  assert.throws(() => assertPublicHttpUrl("http://[::1]/x"), /private_address/);
  assert.throws(() => assertPublicHttpUrl("http://[::ffff:10.0.0.1]/x"), /private_address/);
});

test("assertPublicHttpUrl rejects embedded credentials and garbage", () => {
  assert.throws(() => assertPublicHttpUrl("https://user:pass@example.com/x"), /credentials_not_allowed/);
  assert.throws(() => assertPublicHttpUrl("not a url"), /invalid/);
});

// ── HTML parsing ────────────────────────────────────────────────────

const OG_HTML = `<!doctype html>
<html><head>
<title>fallback title</title>
<meta property="og:title" content="便携榨汁杯 Pro">
<meta property="og:description" content="30秒出汁，Type-C 快充">
<meta property="og:image" content="https://cdn.example.com/hero.jpg">
<meta property="og:site_name" content="Example Store">
</head><body></body></html>`;

test("parseProductHtml extracts Open Graph metadata", () => {
  const product = parseProductHtml(OG_HTML, "https://shop.example.com/p/1");

  assert.ok(product);
  assert.equal(product.name, "便携榨汁杯 Pro");
  assert.equal(product.description, "30秒出汁，Type-C 快充");
  assert.deepEqual(product.imageUrls, ["https://cdn.example.com/hero.jpg"]);
  assert.equal(product.brand, "Example Store");
});

test("parseProductHtml supplements OG with JSON-LD Product fields", () => {
  const html = `<html><head>
<meta property="og:title" content="榨汁杯">
<script type="application/ld+json">
{"@type":"Product","name":"榨汁杯","description":"ld 描述","brand":{"name":"JuiceMax"},"image":["/img/a.jpg"],"offers":{"price":"129","priceCurrency":"CNY"}}
</script>
</head></html>`;
  const product = parseProductHtml(html, "https://shop.example.com/p/1");

  assert.ok(product);
  assert.equal(product.name, "榨汁杯"); // OG wins
  assert.equal(product.description, "ld 描述"); // JSON-LD fills the gap
  assert.equal(product.brand, "JuiceMax");
  assert.equal(product.price, "129");
  assert.equal(product.imageUrls[0], "https://shop.example.com/img/a.jpg"); // absolutized
});

test("parseProductHtml returns null without any product metadata", () => {
  assert.equal(parseProductHtml("<html><head><title>hi</title></head></html>", "https://x.com/"), null);
});

test("parseProductHtml skips broken JSON-LD blocks", () => {
  const html = `<html><head>
<script type="application/ld+json">{ broken json</script>
<meta property="og:title" content="still works">
</head></html>`;
  const product = parseProductHtml(html, "https://x.com/p");
  assert.ok(product);
  assert.equal(product.name, "still works");
});
