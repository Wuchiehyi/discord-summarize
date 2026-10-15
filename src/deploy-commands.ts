import { config } from "dotenv";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env") });

export const summarizeCommand = new SlashCommandBuilder()
  .setName("summarize")
  .setDescription("摘要這段時間裡的頻道訊息")
  .addStringOption((option) =>
    option
      .setName("period")
      .setDescription("沒填開始時間時用。預設是今天")
      .setRequired(false)
      .addChoices(
        { name: "今天", value: "today" },
        { name: "昨天", value: "yesterday" },
        { name: "近 6 小時", value: "6h" },
        { name: "近 24 小時", value: "24h" },
        { name: "近 7 天", value: "7d" },
      ),
  )
  .addStringOption((option) =>
    option
      .setName("from")
      .setDescription("開始時間，台北時間，例如 2026-10-15 09:00。有填會蓋過時段")
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("until")
      .setDescription("結束時間，不填代表現在。只寫日期則到當天結束")
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option.setName("only_me").setDescription("只給自己看").setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("source")
      .setDescription("用地端模型或雲端 API")
      .setRequired(false)
      .addChoices(
        { name: "地端模型", value: "local" },
        { name: "雲端 API", value: "api" },
      ),
  );

export async function deployCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) {
    throw new Error("請在 .env 填 DISCORD_TOKEN、DISCORD_CLIENT_ID。");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), {
    body: [summarizeCommand.toJSON()],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployCommands()
    .then(() => {
      console.log("已註冊全域 /summarize");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
