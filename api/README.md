# Mouth Exercises Game — Stats API

接收前端遊戲結算統計,寫進 SQL Server。Node.js + Express + mssql。

---

## 一次性設定

### 1. 建表

對你的 SQL Server 執行 `schema.sql`(SSMS 或 sqlcmd 都行):

```bash
sqlcmd -S <SERVER> -U <USER> -P <PASSWORD> -d <DB_NAME> -i schema.sql
```

### 2. 安裝相依套件

```bash
cd api
npm install
```

### 3. 設定環境變數

```bash
cp .env.example .env
```

打開 `.env` 填好 SQL 連線資訊(`DB_SERVER`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` 等)。

---

## 本機啟動

```bash
npm start            # 一次性
npm run dev          # 改檔自動重啟(需 nodemon)
```

啟動後驗證:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"db":true}
```

---

## API 規格

### POST /api/game-stats

寫入一筆遊戲結算統計。

Request body:

```json
{
  "playerName": "Alice",
  "mode": "tongue",
  "difficulty": "hard",
  "stats": {
    "⬆️": { "success": 5, "fail": 2 },
    "⬇️": { "success": 4, "fail": 3 },
    "⬅️": { "success": 3, "fail": 4 },
    "➡️": { "success": 6, "fail": 1 }
  },
  "playedAt": "2026-06-02T12:34:56.000Z"
}
```

Response:

```json
{ "ok": true, "id": 42, "totalSuccess": 18, "totalFail": 10, "achievementRate": 64.29 }
```

### GET /api/game-stats?player=Alice&limit=20

取得最近的紀錄(可選用,給排行榜/個人頁面)。

---

## 部署選項(由簡到繁)

| 方案 | 適合 | 流程概覽 |
|------|------|---------|
| **同一台 Windows Server**(IIS + iisnode 或直接 PM2)| 內網,SQL Server 跟 API 同機 | `npm install pm2 -g` → `pm2 start server.js --name mouth-api` → 對外開放 port 3000 / 設防火牆規則 |
| **Azure App Service**(Linux)| Azure SQL 在同一張帳號 | 推 GitHub → 設定 App Settings(對應 `.env`)→ 自動部署 |
| **Docker / Docker Compose**(任何 Linux VM)| 自建 SQL Server / 多服務 | `docker build -t mouth-api .` → `docker run -d -p 3000:3000 --env-file .env mouth-api` |
| **Fly.io / Render / Railway** | 開源託管 / 小型專案 | 連 GitHub,設 secrets,自動部署。SQL Server 用 Azure SQL 或 SQL Server on VM |

部署後**修改前端 `index.html` 內的這一行**指到新 API URL:

```html
<script>window.GAME_API_BASE = 'https://your-api.example.com';</script>
```

---

## 前端要怎麼接

前端會在「遊戲結束顯示結算」時自動 POST 統計。不需要額外串接;只要 `window.GAME_API_BASE` 設對就會送出。

```js
// 已內建在 js/api_client.js → 由 app.js 在 endGame() 呼叫
sendGameStats({ playerName, mode, difficulty, stats });
```

---

## CORS

`.env` 的 `ALLOWED_ORIGINS` 預設 `*`(全部允許)。上線改成你的前端網域,例如:

```
ALLOWED_ORIGINS=https://mouth-exercises.example.com,https://staging.example.com
```
