const DISCORD_LIMIT = 2000;
const TRANSCRIPT_LIMIT = 12000;
const CUT_NOTE = "\n…（後面截掉了）";

const SYSTEM = `  ## 執行步驟 (Steps)
1. **去噪（Noise Reduction）**：自動過濾「哈哈」、「貼圖」、「早安」等無意義廢話。
2. **話題分組（Topic Clustering）**：將跳躍式的聊天內容，依據時間或主題切分成不同的「事件線」。
3. **角色追蹤（User Tracking）**：識別群組裡的主要發言者，以及他們各自的核心立場或爆料。

## 輸出格式規範 (Rules)
請嚴格遵守以下溫和、口語且結構化的排版輸出：

**【目前熱門話題】**
*(用一句話說明大家現在在吵什麼或聊什麼，例如：大家正在團購下午茶/在抱怨主管)*

長話短說懶人包
### [話題時間/主題 A]：(例如：週末聚餐地點)
- **核心進度**：一句話總結這個話題的最終結論或目前卡在哪裡。
- **人物意見**：
  - **【成員A】** 提出了...的看法。
  - **【成員B】** 反對，因為...。

### [話題時間/主題 B]：(例如：某某人的八卦)
- **核心進度**：...
- **人物意見**：...

**【約定與待辦清單】(Action Items)**
- [ ] **【主揪/負責人】** 具體約定的時間、地點或要做的事（例如：小明週五前要訂位）。

---
**爬樓小結**：已為您過濾 \`[X]\` 則廢話與貼圖，目前群組氣氛屬於 \`[
  溫馨 / 歡樂 / 火藥味重 / 揪團中
]\`。
`;
export interface SummarizableMessage {
  type?: number;
  content?: string | null;
  author?: {
    bot?: boolean | null;
    username?: string | null;
    globalName?: string | null;
  } | null;
  createdTimestamp?: number | null;
  timestamp?: string | null;
  attachments?: { size?: number } | readonly unknown[] | null;
}

export interface ChatRequestInit {
  method: string;
  headers: { "Content-Type": string; Authorization?: string };
  body: string;
}

export interface ChatResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<{
    choices?: Array<{ message?: { content?: string | null } }>;
  }>;
}

export type ChatFetch = (
  url: string,
  init: ChatRequestInit,
) => Promise<ChatResponse>;

export interface SummarizeOptions {
  source?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: ChatFetch;
  leadingNote?: string;
}

export interface ProviderConfig {
  source: "api" | "local";
  baseUrl: string;
  model: string;
  apiKey: string;
}

class SummaryFailure extends Error {
  readonly code: "network" | "http";

  constructor(
    message: string,
    code: "network" | "http",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SummaryFailure";
    this.code = code;
  }
}

export function pickMessages<T extends SummarizableMessage>(
  messages: readonly T[],
): T[] {
  return messages.filter((message): message is T => {
    if (!message || message.author?.bot) return false;
    if (message.type !== 0 && message.type !== 19) return false;
    const text = (message.content || "").trim();
    return text.length > 0 || attachmentCount(message) > 0;
  });
}

export function buildTranscript(
  messages: readonly SummarizableMessage[],
  maxChars = TRANSCRIPT_LIMIT,
  leadingNote = "",
): string {
  const lines = [...messages]
    .sort((a, b) => timeOf(a) - timeOf(b))
    .map(formatLine);
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (used + line.length + 1 > maxChars && kept.length > 0) break;
    kept.push(line);
    used += line.length + 1;
  }
  kept.reverse();
  const skipped = lines.length - kept.length;
  const notes = [
    leadingNote,
    skipped > 0 ? `（較早的 ${skipped} 則已略過）` : "",
  ].filter(Boolean);
  const header = notes.length > 0 ? `${notes.join("\n")}\n` : "";
  return header + kept.join("\n");
}

export function splitReply(text: string | null | undefined): string[] {
  const trimmed = (text || "").trim();
  if (!trimmed) return ["摘要是空的。等一下再試。"];
  if (trimmed.length <= DISCORD_LIMIT) return [trimmed];

  const max = DISCORD_LIMIT * 2 - CUT_NOTE.length;
  const truncated = trimmed.length > max;
  const body = truncated ? trimmed.slice(0, max) : trimmed;

  let cut = body.lastIndexOf("\n", DISCORD_LIMIT);
  if (cut < 400) cut = DISCORD_LIMIT;
  const first = body.slice(0, cut).trimEnd().slice(0, DISCORD_LIMIT);
  let second = body.slice(cut).trimStart();
  if (truncated) second += CUT_NOTE;
  if (second.length > DISCORD_LIMIT) {
    second =
      second.slice(0, DISCORD_LIMIT - CUT_NOTE.length).trimEnd() + CUT_NOTE;
  }
  return second ? [first, second] : [first];
}

export function resolveProvider(
  options: SummarizeOptions = {},
): ProviderConfig | { error: string } {
  const env = options.env ?? {};
  const source = options.source || env.SUMMARY_SOURCE || "api";
  if (source !== "api" && source !== "local") {
    return { error: "來源只能是 api 或 local。" };
  }
  if (source === "local") {
    return {
      source,
      baseUrl:
        options.baseUrl || env.LOCAL_BASE_URL || "http://127.0.0.1:11434/v1",
      model: options.model || env.LOCAL_MODEL || "llama3.1",
      apiKey: options.apiKey ?? env.LOCAL_API_KEY ?? "",
    };
  }
  return {
    source: "api",
    baseUrl:
      options.baseUrl || env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: options.model || env.OPENAI_MODEL || "gpt-4o-mini",
    apiKey: options.apiKey ?? env.OPENAI_API_KEY ?? "",
  };
}

export async function summarizeMessages(
  messages: readonly SummarizableMessage[],
  options: SummarizeOptions = {},
): Promise<{ chunks: string[] }> {
  const picked = pickMessages(messages);
  if (picked.length === 0) {
    return { chunks: ["這個時段沒有可摘要的訊息。"] };
  }

  const provider = resolveProvider(options);
  if ("error" in provider) return { chunks: [provider.error] };
  if (provider.source === "api" && !provider.apiKey) {
    return { chunks: ["還沒設定 OPENAI_API_KEY，沒辦法摘要。"] };
  }

  try {
    const text = await completeChat({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      transcript: buildTranscript(
        picked,
        TRANSCRIPT_LIMIT,
        options.leadingNote,
      ),
      fetchImpl: options.fetchImpl,
    });
    const label =
      provider.source === "local"
        ? `地端 · ${provider.model}`
        : `API · ${provider.model}`;
    return { chunks: splitReply(`（${label}）\n${text}`) };
  } catch (error) {
    if (
      provider.source === "local" &&
      error instanceof SummaryFailure &&
      error.code === "network"
    ) {
      return { chunks: ["地端模型連不上。確認它有在跑。"] };
    }
    if (provider.source === "local") {
      return {
        chunks: ["地端模型沒有完成摘要。檢查 LOCAL_BASE_URL 與 LOCAL_MODEL。"],
      };
    }
    return { chunks: ["摘要沒做成。等一下再試，或檢查 API 金鑰與網址。"] };
  }
}

export async function completeChat({
  baseUrl = "https://api.openai.com/v1",
  apiKey,
  model = "gpt-4o-mini",
  transcript,
  fetchImpl = fetch,
}: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  transcript: string;
  fetchImpl?: ChatFetch;
}): Promise<string> {
  const headers: ChatRequestInit["headers"] = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: ChatResponse;
  try {
    response = await fetchImpl(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: transcript },
          ],
        }),
      },
    );
  } catch (error) {
    throw new SummaryFailure("network", "network", { cause: error });
  }
  if (!response.ok) {
    throw new SummaryFailure(`model HTTP ${response.status ?? 0}`, "http");
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty completion");
  return text;
}

function formatLine(message: SummarizableMessage): string {
  const name = message.author?.globalName || message.author?.username || "某人";
  const text = (message.content || "").trim();
  const files = attachmentCount(message);
  const extra = files > 0 ? `（附了 ${files} 個檔案）` : "";
  const body = [text, extra].filter(Boolean).join(" ");
  return `[${formatTime(timeOf(message))}] ${name}: ${body}`;
}

function attachmentCount(message: SummarizableMessage): number {
  const attachments = message.attachments;
  if (!attachments) return 0;
  if (
    typeof attachments === "object" &&
    "size" in attachments &&
    typeof attachments.size === "number"
  ) {
    return attachments.size;
  }
  if (Array.isArray(attachments)) return attachments.length;
  return 0;
}

function timeOf(message: SummarizableMessage): number {
  if (message.createdTimestamp) return message.createdTimestamp;
  if (message.timestamp) return new Date(message.timestamp).getTime();
  return 0;
}

function formatTime(ms: number): string {
  if (!ms) return "--:--";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Taipei",
  }).format(new Date(ms));
}
