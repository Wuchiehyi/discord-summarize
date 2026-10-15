import assert from "node:assert/strict";
import { buildTranscript, pickMessages, splitReply, summarizeMessages } from "./summarize.js";

const bot = {
  type: 0,
  author: { bot: true, username: "bot" },
  content: "機器人在說話",
  createdTimestamp: 1_700_000_000_000,
};
const human = {
  type: 0,
  author: { bot: false, username: "小明" },
  content: "我們決定周五上線",
  createdTimestamp: 1_700_000_060_000,
};
const command = {
  type: 20,
  author: { username: "小明" },
  content: "/summarize",
  createdTimestamp: 1_700_000_120_000,
};

const picked = pickMessages([bot, human, command]);
assert.equal(picked.length, 1);
assert.equal(picked[0].content, "我們決定周五上線");

const transcript = buildTranscript(picked);
assert.match(transcript, /小明/);
assert.match(transcript, /周五上線/);
assert.doesNotMatch(transcript, /機器人在說話/);

const empty = await summarizeMessages([bot, command], { apiKey: "x" });
assert.equal(empty.chunks[0], "這個頻道最近沒有可摘要的訊息。");

const noKey = await summarizeMessages([human], {});
assert.match(noKey.chunks[0], /OPENAI_API_KEY/);

const parts = splitReply("甲".repeat(2500));
assert.ok(parts.length <= 2);
assert.ok(parts.every((part) => part.length <= 2000));
assert.equal(parts[0].length + parts[1].length, 2500);

const huge = splitReply(`${"乙\n".repeat(3000)}`);
assert.equal(huge.length, 2);
assert.ok(huge.every((part) => part.length <= 2000));
assert.match(huge[1], /後面截掉了/);

const oldLine = {
  type: 0,
  author: { username: "舊" },
  content: "這則很舊不該出現",
  createdTimestamp: 1,
};
const newLine = {
  type: 0,
  author: { username: "新" },
  content: "留這則",
  createdTimestamp: 2,
};
const short = buildTranscript([oldLine, newLine], 20);
assert.match(short, /較早的 1 則已略過/);
assert.match(short, /留這則/);
assert.doesNotMatch(short, /這則很舊不該出現/);

const summarized = await summarizeMessages([bot, human], {
  apiKey: "test",
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.match(body.messages[1].content, /周五上線/);
    assert.doesNotMatch(body.messages[1].content, /機器人在說話/);
    assert.equal(init.headers.Authorization, "Bearer test");
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "## 這段在聊什麼\n周五上線" } }],
      }),
    };
  },
});
assert.deepEqual(summarized.chunks, ["（API · gpt-4o-mini）\n## 這段在聊什麼\n周五上線"]);

const local = await summarizeMessages([human], {
  source: "local",
  env: { LOCAL_MODEL: "qwen2.5" },
  fetchImpl: async (url, init) => {
    assert.equal(url, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(JSON.parse(init.body).model, "qwen2.5");
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "地端摘要" } }] }),
    };
  },
});
assert.match(local.chunks[0], /地端 · qwen2.5/);

const offline = await summarizeMessages([human], {
  source: "local",
  fetchImpl: async () => {
    throw new TypeError("fetch failed");
  },
});
assert.equal(offline.chunks[0], "地端模型連不上。確認它有在跑。");

const badSource = await summarizeMessages([human], { source: "cloud", apiKey: "x" });
assert.equal(badSource.chunks[0], "來源只能是 api 或 local。");

const failed = await summarizeMessages([human], {
  apiKey: "test",
  fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
});
assert.equal(failed.chunks[0], "摘要沒做成。等一下再試，或檢查 API 金鑰與網址。");

console.log("ok");
