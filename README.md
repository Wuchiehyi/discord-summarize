# Discord 摘要機器人

在頻道裡打 `/summarize`，把一段時間內的訊息整理成繁體中文：在聊什麼、決定了什麼、誰還有待辦、還沒講完的點。時間用台北時間。

## 準備

1. 到 [Discord Developer Portal](https://discord.com/developers/applications) 建一個應用，打開 Bot。
2. 在 Bot 頁打開 **Message Content Intent**。沒開的話，歷史訊息的內文會是空的。
3. 用這個網址邀請進伺服器（把 `CLIENT_ID` 換成應用的 Application ID）：

   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=2048`

   `2048` 是讀取與發送訊息。
4. 伺服器 ID 用開發者模式對伺服器圖示按右鍵複製。

## 設定

```bash
cd C:\Users\leo50\Code\discord-summarize
npm install
copy .env.example .env
```

`.env` 要填：

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`

摘要來源有兩個，指令裡可以臨時換，沒選就用 `SUMMARY_SOURCE`（`api` 或 `local`）。

雲端 API 要填 `OPENAI_API_KEY`。`OPENAI_BASE_URL` 與 `OPENAI_MODEL` 可換任何 OpenAI 相容的 Chat Completions。

地端模型走同一種介面，預設是 Ollama：`http://127.0.0.1:11434/v1`。先讓它在本機跑著，並把 `LOCAL_MODEL` 設成你已經拉下來的模型名稱。不需要金鑰。LM Studio 把 `LOCAL_BASE_URL` 改成 `http://127.0.0.1:1234/v1`。有的地端服務會要一把假金鑰，那就填 `LOCAL_API_KEY`。

## 啟動

```bash
npm run deploy
npm start
```

`deploy` 會把這個應用在該伺服器的斜線指令覆寫成只有 `/summarize`。指令註冊後通常幾秒內出現。

## 使用

- `/summarize`：摘要今天 00:00 到現在，來源用 `.env` 的 `SUMMARY_SOURCE`。
- `/summarize period:昨天`：也可以選近 6 小時、近 24 小時、近 7 天。
- `/summarize from:2026-10-15 09:00 until:2026-10-15 18:00`：自訂起迄。有填 `from` 會蓋過 `period`。
- `until` 可以不填，代表到現在。只寫日期時，開始是當天 00:00，結束是當天結束。
- `/summarize source:local`：這次改走地端模型。
- `/summarize source:api`：這次改走雲端 API。
- `/summarize only_me:True`：只有自己看得到。

這段時間最多抓 500 則較新的訊息。討論串裡下指令，摘要的是該討論串。其他機器人和斜線指令不會算進去。訊息內容只在這一次請求裡送給模型，不寫進檔案。改了指令之後要再跑一次 `npm run deploy`。
