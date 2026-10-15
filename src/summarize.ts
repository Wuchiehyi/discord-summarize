const DISCORD_LIMIT = 2000;
const TRANSCRIPT_LIMIT = 12000;
const CUT_NOTE = "\n…（後面截掉了）";

const SYSTEM = `你是 Discord 頻道摘要。只用繁體中文，依序輸出這四段，每段用這個標題開頭：
## 這段在聊什麼
## 決定了什麼
## 誰還有待辦
## 還沒講完的點
沒有內容的段落寫「沒有」。不要捏造沒出現的決定或待辦。不要輸出程式碼區塊。整篇少於 1500 字。`;

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

export type ChatFetch = (url: string, init: ChatRequestInit) => Promise<ChatResponse>;

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

  constructor(message: string, code: "network" | "http", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SummaryFailure";
    this.code = code;
  }
}

export function pickMessages<T extends SummarizableMessage>(messages: readonly T[]): T[] {
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
  const lines = [...messages].sort((a, b) => timeOf(a) - timeOf(b)).map(formatLine);
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
    second = second.slice(0, DISCORD_LIMIT - CUT_NOTE.length).trimEnd() + CUT_NOTE;
  }
  return second ? [first, second] : [first];
}

export function resolveProvider(options: SummarizeOptions = {}): ProviderConfig | { error: string } {
  const env = options.env ?? {};
  const source = options.source || env.SUMMARY_SOURCE || "api";
  if (source !== "api" && source !== "local") {
    return { error: "來源只能是 api 或 local。" };
  }
  if (source === "local") {
    return {
      source,
      baseUrl: options.baseUrl || env.LOCAL_BASE_URL || "http://127.0.0.1:11434/v1",
      model: options.model || env.LOCAL_MODEL || "llama3.1",
      apiKey: options.apiKey ?? env.LOCAL_API_KEY ?? "",
    };
  }
  return {
    source: "api",
    baseUrl: options.baseUrl || env.OPENAI_BASE_URL || "https://api.openai.com/v1",
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
      transcript: buildTranscript(picked, TRANSCRIPT_LIMIT, options.leadingNote),
      fetchImpl: options.fetchImpl,
    });
    const label = provider.source === "local" ? `地端 · ${provider.model}` : `API · ${provider.model}`;
    return { chunks: splitReply(`（${label}）\n${text}`) };
  } catch (error) {
    if (provider.source === "local" && error instanceof SummaryFailure && error.code === "network") {
      return { chunks: ["地端模型連不上。確認它有在跑。"] };
    }
    if (provider.source === "local") {
      return { chunks: ["地端模型沒有完成摘要。檢查 LOCAL_BASE_URL 與 LOCAL_MODEL。"] };
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
  const headers: ChatRequestInit["headers"] = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: ChatResponse;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
    });
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
  if (typeof attachments === "object" && "size" in attachments && typeof attachments.size === "number") {
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
