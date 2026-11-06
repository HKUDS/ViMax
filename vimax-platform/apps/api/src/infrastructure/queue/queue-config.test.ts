import assert from "node:assert/strict";
import test from "node:test";
import {
  QUEUE_NAMES,
  QUEUE_OPTIONS,
  REDIS_QUEUE_PREFIX,
  asQueueName,
  redisListKeyFor,
} from "./queue-config.js";

test("redisListKeyFor prefixes the queue name", () => {
  assert.equal(redisListKeyFor("q.image.std"), "vimax:queue:q.image.std");
  assert.equal(redisListKeyFor("q.pipeline.full"), "vimax:queue:q.pipeline.full");
});

test("redisListKeyFor uses the exported prefix", () => {
  assert.equal(redisListKeyFor("x"), `${REDIS_QUEUE_PREFIX}x`);
});

test("every queue name has options and a distinct list key", () => {
  const keys = new Set<string>();
  for (const name of QUEUE_NAMES) {
    const opts = QUEUE_OPTIONS[name];
    assert.ok(opts, `missing options for ${name}`);
    assert.ok(opts.concurrency > 0, `${name} concurrency must be positive`);
    assert.ok(opts.attempts > 0, `${name} attempts must be positive`);
    assert.ok(opts.schema, `${name} must have a payload schema`);
    const key = redisListKeyFor(name);
    assert.ok(!keys.has(key), `duplicate list key ${key}`);
    keys.add(key);
  }
});

test("asQueueName returns the name for known queues", () => {
  assert.equal(asQueueName("q.audio.std"), "q.audio.std");
});

test("asQueueName throws for an unknown queue", () => {
  assert.throws(() => asQueueName("q.nope"), /Unknown queue/);
});
