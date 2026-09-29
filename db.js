const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('数据库连接失败:', err.message);
  } else {
    console.log('数据库就绪:', dbPath);
  }
});

// 初始化表
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      code        TEXT PRIMARY KEY,
      content     TEXT NOT NULL,
      mime        TEXT NOT NULL DEFAULT 'text',
      max_uses    INTEGER NOT NULL DEFAULT 1,
      used        INTEGER NOT NULL DEFAULT 0,
      expires_at  INTEGER NOT NULL,
      type        TEXT NOT NULL DEFAULT 'once'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS extracts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      code      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ip        TEXT
    )
  `);
});

/* 码规则：6 位数字 + 2 个字母
 * 首字母 = 6 位数字之和 mod 26  对应 A~Z  (校验位)
 * 第二个字母 = 随机 A~Z
 */
function checksumLetter(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += parseInt(digits[i], 10) || 0;
  }
  return String.fromCharCode(65 + (sum % 26));
}

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += Math.floor(Math.random() * 10);
  }
  return s;
}

function randomLetter() {
  return String.fromCharCode(65 + Math.floor(Math.random() * 26));
}

function generateCode() {
  const digits = randomDigits(6);
  return digits + checksumLetter(digits) + randomLetter();
}

// 校验 8 位码格式
function validateCodeFormat(code) {
  return /^[0-9]{6}[A-Z]{2}$/.test(code);
}

// 校验码的校验位是否正确
function verifyCode(code) {
  if (!validateCodeFormat(code)) return false;
  const digits = code.slice(0, 6);
  const check = code[6];
  return checksumLetter(digits) === check;
}

// 异步生成唯一码 (最多重试 20 次)
async function createUniqueCode() {
  for (let i = 0; i < 20; i++) {
    const code = generateCode();
    const exists = await new Promise((resolve) => {
      db.get('SELECT 1 FROM messages WHERE code = ?', [code], (err, row) => {
        resolve(!!row);
      });
    });
    if (!exists) return code;
  }
  throw new Error('码生成冲突，请重试');
}

// 创建留言
function insertMessage(code, content, mime, type, maxUses, expiresAt) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO messages (code, content, mime, max_uses, used, expires_at, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [code, content, mime, maxUses, 0, expiresAt, type],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

// 查询留言
function findMessage(code) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM messages WHERE code = ?', [code], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// 记录一次提取
function logExtract(code, ip) {
  return new Promise((resolve) => {
    db.run(
      'INSERT INTO extracts (code, created_at, ip) VALUES (?, ?, ?)',
      [code, Date.now(), ip],
      resolve
    );
  });
}

// 提取时记录使用 + 判定是否删除
async function recordExtraction(code, ip) {
  const msg = await findMessage(code);
  if (!msg) return { error: 'not_found' };

  const now = Date.now();
  if (msg.expires_at < now) {
    await new Promise((r) => db.run('DELETE FROM messages WHERE code = ?', [code], r));
    return { error: 'expired' };
  }

  const nextUsed = msg.used + 1;
  if (nextUsed >= msg.max_uses) {
    await new Promise((r) => db.run('DELETE FROM messages WHERE code = ?', [code], r));
  } else {
    await new Promise((r) =>
      db.run('UPDATE messages SET used = ? WHERE code = ?', [nextUsed, code], r)
    );
  }

  await logExtract(code, ip);
  return {
    content: msg.content,
    mime: msg.mime,
    remaining: msg.max_uses - nextUsed,
    deleted: nextUsed >= msg.max_uses,
    total: msg.max_uses,
  };
}

// 清理过期留言
function cleanupExpired() {
  return new Promise((resolve) => {
    db.run('DELETE FROM messages WHERE expires_at < ?', [Date.now()], resolve);
  });
}

// 启动时清理过期
setTimeout(() => cleanupExpired(), 2000);
// 每 10 分钟清理一次
setInterval(() => cleanupExpired(), 10 * 60 * 1000);

module.exports = {
  db,
  generateCode,
  createUniqueCode,
  checksumLetter,
  validateCodeFormat,
  verifyCode,
  insertMessage,
  findMessage,
  logExtract,
  recordExtraction,
  cleanupExpired,
};
