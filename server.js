require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── 資料庫路徑 ────────────────────────────────────────────────────
// Azure 環境（WEBSITE_SITE_NAME 有值）存到 /home 持久磁碟；
// 本機開發則存在專案根目錄。
const dbPath = process.env.WEBSITE_SITE_NAME ? '/home/data.db' : './data.db';

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ 資料庫連線失敗：', err.message);
        return;
    }
    console.log(`✅ 成功連接到 SQLite 資料庫 (${dbPath})`);

    db.run(`
        CREATE TABLE IF NOT EXISTS prices (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            date   TEXT    NOT NULL,
            name   TEXT    NOT NULL,
            price  REAL    NOT NULL,
            source TEXT    NOT NULL DEFAULT '未指定'
        )
    `, (err) => {
        if (err) console.error('建立資料表失敗：', err.message);
    });
});

// ── 中介層 ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Key 驗證（只用在 POST，讓爬蟲可以寫入，前端只能讀）──────
function requireApiKey(req, res, next) {
    // 清除 key 中任何非 ASCII 可見字元（防止 .env 含 BOM 或換行）
    const envKey     = (process.env.SCRAPER_API_KEY || '').replace(/[^\x20-\x7E]/g, '').trim();
    const incomingKey = (req.headers['x-api-key']   || '').replace(/[^\x20-\x7E]/g, '').trim();

    if (!envKey || incomingKey !== envKey) {
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
    next();
}

// ── GET /api/prices ───────────────────────────────────────────────
// 支援 ?search=  模糊搜尋名稱或來源
// 支援 ?from= 與 ?to=  日期區間（YYYY-MM-DD）
app.get('/api/prices', (req, res) => {
    const { search, from, to } = req.query;

    let sql    = 'SELECT * FROM prices';
    const cond = [];
    const args = [];

    if (search && search.trim()) {
        cond.push('(name LIKE ? OR source LIKE ?)');
        args.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }
    if (from && from.trim()) {
        cond.push('date >= ?');
        args.push(from.trim());
    }
    if (to && to.trim()) {
        cond.push('date <= ?');
        args.push(to.trim());
    }

    if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
    sql += ' ORDER BY date DESC, id DESC';

    db.all(sql, args, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ── POST /api/prices ──────────────────────────────────────────────
// 僅供爬蟲呼叫，必須攜帶 X-API-Key header
app.post('/api/prices', requireApiKey, (req, res) => {
    const { date, name, price, source } = req.body;

    if (!date || !name || price == null) {
        return res.status(400).json({ error: 'date、name、price 為必填欄位' });
    }
    if (isNaN(Number(price))) {
        return res.status(400).json({ error: 'price 必須是數字' });
    }

    const sql = 'INSERT INTO prices (date, name, price, source) VALUES (?, ?, ?, ?)';
    db.run(sql, [
        String(date).trim(),
        String(name).trim(),
        Number(price),
        String(source || '未指定').trim()
    ], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        console.log(`📝 寫入 [id=${this.lastID}] ${date} | ${name} | ${price} | ${source}`);
        res.status(201).json({ id: this.lastID, message: '新增成功' });
    });
});

// ── POST /api/prices/manual ───────────────────────────────────
// 供前端使用者手動新增，無需 API Key
app.post('/api/prices/manual', (req, res) => {
    const { date, name, price, source } = req.body;

    if (!date || !name || price == null) {
        return res.status(400).json({ error: 'date、name、price 為必填欄位' });
    }
    if (isNaN(Number(price))) {
        return res.status(400).json({ error: 'price 必須是數字' });
    }

    const sql = 'INSERT INTO prices (date, name, price, source) VALUES (?, ?, ?, ?)';
    db.run(sql, [
        String(date).trim(),
        String(name).trim(),
        Number(price),
        String(source || '手動輸入').trim()
    ], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        console.log(`✍️  手動寫入 [id=${this.lastID}] ${date} | ${name} | ${price} | ${source || '手動輸入'}`);
        res.status(201).json({ id: this.lastID, message: '新增成功' });
    });
});

// ── SPA fallback ──────────────────────────────────────────────
// ── SPA fallback ──────────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── 啟動 ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
    const keyStatus = (process.env.SCRAPER_API_KEY || '').trim() ? '✅ 啟用' : '⚠️  未設定（建議在 .env 補上 SCRAPER_API_KEY）';
    console.log('╔══════════════════════════════════════════╗');
    console.log(`║  ☕ 阮愛啉咖啡 後端已啟動               ║`);
    console.log(`║  http://localhost:${PORT}                   ║`);
    console.log(`║  API Key 驗證：${keyStatus}  ║`);
    console.log('╚══════════════════════════════════════════╝');
});