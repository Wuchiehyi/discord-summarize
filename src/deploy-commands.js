import { config } from "dotenv";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env") });

export const summarizeCommand = new SlashCommandBuilder()
  .setName("summarize")
  .setDescription("摘要這個頻道最近的訊息")
  .addIntegerOption((option) =>
    option
      .setName("count")
      .setDescription("要看最近幾則，10 到 100")
      .setMinValue(10)
      .setMaxValue(100)
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
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId || !guildId) {
    throw new Error("請在 .env 填 DISCORD_TOKEN、DISCORD_CLIENT_ID、DISCORD_GUILD_ID。");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: [summarizeCommand.toJSON()],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployCommands()
    .then(() => {
      console.log("已註冊 /summarize");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
