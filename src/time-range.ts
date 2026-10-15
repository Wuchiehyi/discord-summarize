import { SnowflakeUtil } from "discord.js";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const PAGE_SIZE = 100;

export const MESSAGE_CAP = 500;
export const TRUNCATED_NOTE = `（這段時間較早的訊息已略過，只留最近 ${MESSAGE_CAP} 則）`;

const PERIODS = ["today", "yesterday", "6h", "24h", "7d"] as const;
const FORMAT_ERROR = "時間請寫成 2026-10-15 09:00，或只寫 2026-10-15。";
const FROM_REQUIRED = "請填開始時間，例如 2026-10-15 09:00。";
const ORDER_ERROR = "結束時間要晚於開始時間。";

export type Period = (typeof PERIODS)[number];

export interface TimeRangeInput {
  period?: string | null;
  from?: string | null;
  until?: string | null;
  now?: number;
}

export type TimeRange = { start: number; end: number };
export type TimeRangeResult = TimeRange | { error: string };

export interface RangedMessage {
  id: string;
  createdTimestamp: number;
}

export interface MessagePage<T> {
  size: number;
  values(): Iterable<T>;
}

export function resolveTimeRange(input: TimeRangeInput = {}): TimeRangeResult {
  const now = input.now ?? Date.now();
  const from = input.from?.trim() ?? "";
  const until = input.until?.trim() ?? "";

  if (!from && until) return { error: FROM_REQUIRED };
  if (from) {
    const start = parseTaipei(from, "from");
    if (typeof start !== "number") return { error: start };
    const end = until ? parseTaipei(until, "until") : now;
    if (typeof end !== "number") return { error: end };
    if (end < start) return { error: ORDER_ERROR };
    return { start, end };
  }

  const period = input.period?.trim() || "today";
  if (!isPeriod(period)) return { error: "時段只能是今天、昨天、近 6 小時、近 24 小時或近 7 天。" };
  return presetRange(period, now);
}

export async function fetchMessagesInRange<T extends RangedMessage>(
  fetchPage: (options: { limit: number; before: string }) => Promise<MessagePage<T>>,
  start: number,
  end: number,
  limit = MESSAGE_CAP,
): Promise<{ messages: T[]; truncated: boolean }> {
  let before = SnowflakeUtil.generate({ timestamp: end + 1, increment: 0n }).toString();
  const messages: T[] = [];
  let truncated = false;

  while (messages.length < limit) {
    const batch = await fetchPage({ limit: PAGE_SIZE, before });
    const page = [...batch.values()].sort(newerFirst);
    const oldest = page[page.length - 1];
    if (!oldest || oldest.id === before) break;

    let reachedStart = false;
    for (const message of page) {
      if (message.createdTimestamp > end) continue;
      if (message.createdTimestamp < start) {
        reachedStart = true;
        break;
      }
      if (messages.length >= limit) {
        truncated = true;
        break;
      }
      messages.push(message);
    }

    if (truncated || reachedStart) break;
    if (messages.length >= limit) {
      truncated = true;
      break;
    }
    if (page.length < PAGE_SIZE) break;
    before = oldest.id;
  }

  return { messages, truncated };
}

function presetRange(period: Period, now: number): TimeRange {
  if (period === "6h") return { start: now - 6 * 60 * 60 * 1000, end: now };
  if (period === "24h") return { start: now - 24 * 60 * 60 * 1000, end: now };
  if (period === "7d") return { start: now - 7 * 24 * 60 * 60 * 1000, end: now };
  const today = taipeiDate(now);
  const startToday = midnight(today);
  if (period === "yesterday") {
    return { start: midnight(addDays(today, -1)), end: startToday - 1 };
  }
  return { start: startToday, end: now };
}

function parseTaipei(value: string, role: "from" | "until"): number | string {
  const dateTime = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const match = dateTime ?? dateOnly;
  if (!match) return FORMAT_ERROR;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = dateTime ? Number(match[4]) : 0;
  const minute = dateTime ? Number(match[5]) : 0;
  const instant = zonedTime(year, month, day, hour, minute);
  if (instant === null) return FORMAT_ERROR;
  if (!dateTime && role === "until") return midnight(addDays({ year, month, day }, 1)) - 1;
  return instant;
}

function midnight(date: { year: number; month: number; day: number }): number {
  return zonedTime(date.year, date.month, date.day, 0, 0) ?? Number.NaN;
}

function zonedTime(year: number, month: number, day: number, hour: number, minute: number): number | null {
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - TAIPEI_OFFSET_MS;
  const parts = taipeiDate(utc);
  if (parts.year !== year || parts.month !== month || parts.day !== day) return null;
  return utc;
}

function taipeiDate(ms: number): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value);
}

function newerFirst<T extends RangedMessage>(a: T, b: T): number {
  if (a.createdTimestamp !== b.createdTimestamp) return b.createdTimestamp - a.createdTimestamp;
  if (a.id === b.id) return 0;
  return BigInt(a.id) > BigInt(b.id) ? -1 : 1;
}
