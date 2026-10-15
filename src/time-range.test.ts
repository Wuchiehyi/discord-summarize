import assert from "node:assert/strict";
import { SnowflakeUtil } from "discord.js";
import { fetchMessagesInRange, resolveTimeRange, type RangedMessage } from "./time-range.js";

const NOW = Date.parse("2026-10-15T07:30:00.000Z");
const TODAY_START = Date.parse("2026-10-14T16:00:00.000Z");

function rangeOf(input: Parameters<typeof resolveTimeRange>[0]) {
  const result = resolveTimeRange({ ...input, now: NOW });
  if ("error" in result) assert.fail(result.error);
  return result;
}

const today = rangeOf({});
assert.equal(today.start, TODAY_START);
assert.equal(today.end, NOW);

const yesterday = rangeOf({ period: "yesterday" });
assert.equal(yesterday.start, Date.parse("2026-10-13T16:00:00.000Z"));
assert.equal(yesterday.end, TODAY_START - 1);

const sixHours = rangeOf({ period: "6h" });
assert.equal(sixHours.start, NOW - 6 * 60 * 60 * 1000);
assert.equal(sixHours.end, NOW);

const custom = rangeOf({
  period: "yesterday",
  from: "2026-10-15 09:00",
  until: "2026-10-15 18:00",
});
assert.equal(custom.start, Date.parse("2026-10-15T01:00:00.000Z"));
assert.equal(custom.end, Date.parse("2026-10-15T10:00:00.000Z"));

const openEnded = rangeOf({ from: "2026-10-15 09:00" });
assert.equal(openEnded.end, NOW);

const wholeDay = rangeOf({ from: "2026-10-14", until: "2026-10-14" });
assert.equal(wholeDay.start, Date.parse("2026-10-13T16:00:00.000Z"));
assert.equal(wholeDay.end, Date.parse("2026-10-14T15:59:59.999Z"));

function errorOf(input: Parameters<typeof resolveTimeRange>[0]) {
  const result = resolveTimeRange({ ...input, now: NOW });
  if (!("error" in result)) assert.fail("expected an error");
  return result.error;
}

assert.equal(errorOf({ until: "2026-10-15 18:00" }), "請填開始時間，例如 2026-10-15 09:00。");
assert.equal(errorOf({ from: "10/15" }), "時間請寫成 2026-10-15 09:00，或只寫 2026-10-15。");
assert.equal(errorOf({ from: "2026-02-31" }), "時間請寫成 2026-10-15 09:00，或只寫 2026-10-15。");
assert.equal(
  errorOf({ from: "2026-10-15 18:00", until: "2026-10-15 09:00" }),
  "結束時間要晚於開始時間。",
);

function message(timestamp: number): RangedMessage {
  return {
    id: SnowflakeUtil.generate({ timestamp, increment: 0n }).toString(),
    createdTimestamp: timestamp,
  };
}

function pages(all: RangedMessage[]) {
  const calls: Array<{ limit: number; before: string }> = [];
  return {
    calls,
    fetch(options: { limit: number; before: string }) {
      calls.push(options);
      const slice = all
        .filter((item) => BigInt(item.id) < BigInt(options.before))
        .sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1))
        .slice(0, options.limit);
      return Promise.resolve({ size: slice.length, values: () => slice });
    },
  };
}

const base = Date.parse("2026-10-15T00:00:00.000Z");
const history = [0, 1, 2, 3, 4].map((index) => message(base + index * 60_000));
const bounded = pages(history);
const stopped = await fetchMessagesInRange(
  (options) => bounded.fetch(options),
  base + 2 * 60_000,
  base + 4 * 60_000,
);
assert.deepEqual(
  stopped.messages.map((item) => item.createdTimestamp),
  [base + 4 * 60_000, base + 3 * 60_000, base + 2 * 60_000],
);
assert.equal(stopped.truncated, false);

const many = Array.from({ length: 520 }, (_, index) => message(base + index * 1000));
const capped = pages(many);
const truncated = await fetchMessagesInRange((options) => capped.fetch(options), base, base + 519 * 1000);
assert.equal(truncated.messages.length, 500);
assert.equal(truncated.truncated, true);
assert.equal(truncated.messages.some((item) => item.createdTimestamp === base), false);
assert.equal(truncated.messages.some((item) => item.createdTimestamp === base + 519 * 1000), true);
