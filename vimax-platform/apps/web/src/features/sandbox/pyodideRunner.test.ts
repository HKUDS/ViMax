import assert from "node:assert/strict";
import test from "node:test";
import { collectOutputFiles } from "./pyodideRunner.js";

const read = (bytes: number[]) => (name: string) =>
  Uint8Array.from(bytes.map((b) => b + name.length));

test("collectOutputFiles infers mime from common extensions", () => {
  const files = collectOutputFiles(
    ["chart.png", "photo.jpeg", "shot.webp", "result.json"],
    read([1, 2]),
  );

  assert.deepEqual(
    files.map((f) => f.mimeType),
    ["image/png", "image/jpeg", "image/webp", "application/json"],
  );
});

test("collectOutputFiles is case-insensitive and treats jpg as jpeg", () => {
  const files = collectOutputFiles(["IMG.JPG", "Frame.Jpg"], read([]));

  assert.deepEqual(
    files.map((f) => f.mimeType),
    ["image/jpeg", "image/jpeg"],
  );
});

test("collectOutputFiles falls back to octet-stream for unknown or missing extensions", () => {
  const files = collectOutputFiles(["model.bin", "README", "archive.tar.gz"], read([7]));

  assert.deepEqual(
    files.map((f) => f.mimeType),
    ["application/octet-stream", "application/octet-stream", "application/octet-stream"],
  );
});

test("collectOutputFiles returns empty list and passes bytes/name through", () => {
  assert.deepEqual(collectOutputFiles([], read([1])), []);

  const [file] = collectOutputFiles(["out.png"], read([9, 9]));
  assert.equal(file?.name, "out.png");
  assert.deepEqual(file?.bytes, Uint8Array.from([16, 16]));
});
