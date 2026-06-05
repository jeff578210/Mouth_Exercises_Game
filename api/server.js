// Mouth Exercises Game — Stats API
// 接收前端遊戲結算統計,寫進 SQL Server。
//
// 啟動:
//   npm install
//   cp .env.example .env  (填好 SQL 連線資訊)
//   npm start
//
// 部署:見 README.md
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();
app.use(express.json({ limit: '64kb' }));

// CORS:預設允許所有來源(內網部署無妨);上線時把 ALLOWED_ORIGINS 改成你的前端網域
const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} 未允許`));
  },
}));

// SQL Server 連線設定(從 .env 讀)
const dbConfig = {
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server:   process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: (process.env.DB_ENCRYPT || 'true') === 'true',          // Azure SQL 必須 true
    trustServerCertificate: (process.env.DB_TRUST_CERT || 'false') === 'true', // 自簽憑證才 true
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise;
async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig).then(pool => {
      console.log('✅ SQL Server 連線成功');
      return pool;
    }).catch(err => {
      console.error('❌ SQL Server 連線失敗:', err.message);
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// 健康檢查 — 部署後可用 curl 驗證
app.get('/api/health', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT 1 AS ok');
    res.json({ ok: true, db: r.recordset[0].ok === 1 });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// 收結算統計
app.post('/api/game-stats', async (req, res) => {
  const { playerName, mode, difficulty, stats, playedAt } = req.body || {};

  // 基本驗證
  if (!playerName || typeof playerName !== 'string' || playerName.length > 50)
    return res.status(400).json({ ok: false, error: 'playerName 缺少或過長' });
  if (!['tongue', 'mouth', 'voice'].includes(mode))
    return res.status(400).json({ ok: false, error: 'mode 必須是 tongue/mouth/voice' });
  if (!['tutorial', 'easy', 'medium', 'hard'].includes(difficulty))
    return res.status(400).json({ ok: false, error: 'difficulty 必須是 tutorial/easy/medium/hard' });
  if (!stats || typeof stats !== 'object')
    return res.status(400).json({ ok: false, error: 'stats 缺少' });

  // 計算總計
  let totalSuccess = 0, totalFail = 0;
  for (const k in stats) {
    totalSuccess += Number(stats[k]?.success) || 0;
    totalFail    += Number(stats[k]?.fail)    || 0;
  }
  const totalAttempts = totalSuccess + totalFail;
  const achievementRate = totalAttempts > 0 ? +(totalSuccess / totalAttempts * 100).toFixed(2) : 0;

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('PlayerName',      sql.NVarChar(50),  playerName)
      .input('Mode',            sql.NVarChar(20),  mode)
      .input('Difficulty',      sql.NVarChar(20),  difficulty)
      .input('TotalSuccess',    sql.Int,           totalSuccess)
      .input('TotalFail',       sql.Int,           totalFail)
      .input('AchievementRate', sql.Decimal(5, 2), achievementRate)
      .input('PlayedAt',        sql.DateTime2,     playedAt ? new Date(playedAt) : new Date())
      .input('RawStatsJson',    sql.NVarChar(sql.MAX), JSON.stringify(stats))
      .query(`
        INSERT INTO GameSessions
          (PlayerName, Mode, Difficulty, TotalSuccess, TotalFail, AchievementRate, PlayedAt, RawStatsJson)
        OUTPUT INSERTED.Id
        VALUES
          (@PlayerName, @Mode, @Difficulty, @TotalSuccess, @TotalFail, @AchievementRate, @PlayedAt, @RawStatsJson);
      `);
    res.json({
      ok: true,
      id: result.recordset[0].Id,
      totalSuccess, totalFail, achievementRate,
    });
  } catch (e) {
    console.error('插入失敗:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 查詢:同一玩家的歷史(可選用,給排行榜/個人頁面)
app.get('/api/game-stats', async (req, res) => {
  const player = (req.query.player || '').toString().slice(0, 50);
  const limit  = Math.min(parseInt(req.query.limit || '20', 10), 100);
  try {
    const pool = await getPool();
    const q = pool.request().input('Limit', sql.Int, limit);
    let where = '';
    if (player) { q.input('Player', sql.NVarChar(50), player); where = 'WHERE PlayerName = @Player'; }
    const r = await q.query(`
      SELECT TOP (@Limit)
        Id, PlayerName, Mode, Difficulty,
        TotalSuccess, TotalFail, AchievementRate,
        PlayedAt, CreatedAt
      FROM GameSessions ${where}
      ORDER BY CreatedAt DESC;
    `);
    res.json({ ok: true, rows: r.recordset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => console.log(`🚀 Mouth Exercises API 啟動於 http://localhost:${PORT}`));
