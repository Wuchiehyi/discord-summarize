import { config } from "dotenv";
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { summarizeMessages } from "./summarize.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env") });

export function createBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "summarize") return;

    const onlyMe = interaction.options.getBoolean("only_me") ?? false;
    const flags = onlyMe ? MessageFlags.Ephemeral : undefined;
    try {
      await interaction.deferReply(flags ? { flags } : {});
      const channel = interaction.channel;
      if (!channel || !("messages" in channel) || !channel.messages) {
        await interaction.editReply("這個地方沒有訊息可讀。請在伺服器頻道裡用。");
        return;
      }

      const count = interaction.options.getInteger("count") ?? 30;
      const fetched = await channel.messages.fetch({ limit: count });
      const { chunks } = await summarizeMessages([...fetched.values()], {
        source: interaction.options.getString("source") ?? undefined,
        env: process.env,
      });

      await interaction.editReply(chunks[0]);
      if (chunks[1]) {
        await interaction.followUp(flags ? { content: chunks[1], flags } : { content: chunks[1] });
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      const notice = "讀訊息或摘要時出錯了。等一下再試。";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(notice).catch(() => {});
      } else {
        await interaction.reply({ content: notice, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  return client;
}

export async function startBot() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("請在 .env 填 DISCORD_TOKEN。");
  }
  const client = createBot();
  await client.login(token);
  console.log("摘要機器人已上線");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBot().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
