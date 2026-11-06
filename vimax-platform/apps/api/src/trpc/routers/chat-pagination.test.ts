import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateConversations,
  paginateMessages,
} from "./chat-pagination.js";

test("paginateConversations applies cursor before slicing the next page", () => {
  const rows = [
    { id: "conv-4", updatedAt: new Date("2026-06-08T10:03:00Z") },
    { id: "conv-3", updatedAt: new Date("2026-06-08T10:02:00Z") },
    { id: "conv-2", updatedAt: new Date("2026-06-08T10:01:00Z") },
    { id: "conv-1", updatedAt: new Date("2026-06-08T10:00:00Z") },
  ];

  const firstPage = paginateConversations(rows, { limit: 2 });
  assert.deepEqual(
    firstPage.items.map((row) => row.id),
    ["conv-4", "conv-3"],
  );
  assert.equal(firstPage.nextCursor, "conv-3");

  const secondPage = paginateConversations(rows, {
    cursor: firstPage.nextCursor ?? undefined,
    limit: 2,
  });
  assert.deepEqual(
    secondPage.items.map((row) => row.id),
    ["conv-2", "conv-1"],
  );
  assert.equal(secondPage.nextCursor, null);
});

test("paginateMessages applies numeric cursors without repeating earlier rows", () => {
  const rows = [
    { id: 101, content: "first" },
    { id: 102, content: "second" },
    { id: 103, content: "third" },
    { id: 104, content: "fourth" },
  ];

  const firstPage = paginateMessages(rows, { limit: 2 });
  assert.deepEqual(
    firstPage.items.map((row) => row.id),
    [101, 102],
  );
  assert.equal(firstPage.nextCursor, 102);

  const secondPage = paginateMessages(rows, {
    cursor: firstPage.nextCursor ?? undefined,
    limit: 2,
  });
  assert.deepEqual(
    secondPage.items.map((row) => row.id),
    [103, 104],
  );
  assert.equal(secondPage.nextCursor, null);
});
