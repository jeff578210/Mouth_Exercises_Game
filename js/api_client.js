// js/api_client.js
// 把遊戲結算統計送到後端 API 寫進 SQL Server。
// API URL 在 index.html 用 window.GAME_API_BASE 設定,部署時改那邊即可。

const API_BASE = () => (window.GAME_API_BASE || '').replace(/\/$/, '');

/**
 * @param {object} payload
 * @param {string} payload.playerName
 * @param {'tongue'|'mouth'|'voice'} payload.mode
 * @param {'tutorial'|'easy'|'medium'|'hard'} payload.difficulty
 * @param {Object<string,{success:number, fail:number}>} payload.stats
 */
export async function sendGameStats(payload) {
  if (!API_BASE()) {
    console.warn('[api_client] window.GAME_API_BASE 未設定,跳過上傳');
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(`${API_BASE()}/api/game-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, playedAt: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.warn('[api_client] 上傳失敗 HTTP', res.status, await res.text().catch(()=>''));
      return { ok: false, status: res.status };
    }
    const body = await res.json().catch(() => ({}));
    console.log('[api_client] 上傳成功', body);
    return { ok: true, ...body };
  } catch (e) {
    console.warn('[api_client] 上傳例外:', e.message);
    return { ok: false, error: e.message };
  }
}

/** 健康檢查(可選用,部署後驗證 API 是否可達)*/
export async function pingApi() {
  if (!API_BASE()) return false;
  try {
    const res = await fetch(`${API_BASE()}/api/health`, { method: 'GET' });
    return res.ok;
  } catch { return false; }
}
