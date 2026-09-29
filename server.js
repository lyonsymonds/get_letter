const express = require('express');
const path = require('path');
const db = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3000;

// 限流：5 次提取尝试 / 分钟 / IP
const rateLimit = new Map();
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 5;

function rateLimited(ip) {
  const now = Date.now();
  const rec = rateLimit.get(ip) || [];
  const fresh = rec.filter((t) => now - t < RATE_WINDOW);
  if (fresh.length >= RATE_MAX) {
    rateLimit.set(ip, fresh);
    return true;
  }
  fresh.push(now);
  rateLimit.set(ip, fresh);
  return false;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态前端
app.use(express.static(path.join(__dirname, 'public')));
// logo.png 从项目根目录提供（用户上传的 logo）
app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'logo.png'));
});

// 计算过期时间戳
function calcExpiresAt(unit) {
  const now = Date.now();
  switch (unit) {
    case '3d': return now + 3 * 24 * 3600 * 1000;
    case '7d': return now + 7 * 24 * 3600 * 1000;
    case '30d': return now + 30 * 24 * 3600 * 1000;
    case '60d': return now + 60 * 24 * 3600 * 1000;
    case 'permanent': return now + 365 * 24 * 3600 * 1000;
    default: return now + 7 * 24 * 3600 * 1000;
  }
}

// HTML 转义
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---- API: 创建留言 ----
// body: { text?: string, image?: string, type: 'once'|'repeat', maxUses?: number, expiresAt?: string }
app.post('/api/create', async (req, res) => {
  try {
    const { text, image, type = 'once', maxUses = 1, expiresAt } = req.body;

    // 组装内容对象
    const contentObj = {};
    if (text && typeof text === 'string' && text.trim()) {
      if (text.length > 500) {
        return res.status(400).json({ ok: false, msg: '文字不能超过500字' });
      }
      contentObj.text = text.trim();
    }
    if (image && typeof image === 'string' && image.startsWith('data:image')) {
      // 简单校验 base64 长度 (粗略)
      if (image.length > 1.5 * 1024 * 1024) {
        return res.status(400).json({ ok: false, msg: '图片过大，≤1MB' });
      }
      contentObj.image = image;
    }

    if (Object.keys(contentObj).length === 0) {
      return res.status(400).json({ ok: false, msg: '请至少输入文字或上传图片' });
    }

    // 确定 mime 类型
    let finalMime = 'text';
    if (contentObj.text && contentObj.image) finalMime = 'mixed';
    else if (contentObj.image) finalMime = 'image';

    // 生成唯一码
    const code = await db.createUniqueCode();

    // 过期时间
    let exp = Number(expiresAt) || calcExpiresAt('7d');
    if (isNaN(exp) || exp < Date.now()) exp = calcExpiresAt('7d');

    await db.insertMessage(code, JSON.stringify(contentObj), finalMime, type, Number(maxUses) || 1, exp);

    const expireStr = new Date(exp).toLocaleDateString('zh-CN');
    res.json({ ok: true, code, expiresAt: expireStr, type, mime: finalMime });
  } catch (err) {
    console.error('create error:', err);
    res.status(500).json({ ok: false, msg: '创建失败，请稍后再试' });
  }
});

// ---- API: 提取留言 (JSON) ----
app.get('/api/e/:code', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;

    if (rateLimited(ip)) {
      return res.status(429).json({ ok: false, msg: '操作频繁，请稍后再试' });
    }

    let { code } = req.params;
    code = String(code).toUpperCase().replace(/\s+/g, '');

    if (!db.validateCodeFormat(code)) {
      return res.status(400).json({ ok: false, msg: '验证码格式错误，请检查输入' });
    }
    if (!db.verifyCode(code)) {
      return res.status(400).json({ ok: false, msg: '验证码校验错误，请检查输入' });
    }

    const result = await db.recordExtraction(code, ip);

    if (result.error === 'expired') {
      return res.status(410).json({ ok: false, msg: '该验证码已过期' });
    }
    if (result.error === 'not_found') {
      return res.status(404).json({ ok: false, msg: '验证码无效或已被提取' });
    }

    // 解析内容
    let contentObj = {};
    try {
      contentObj = JSON.parse(result.content);
    } catch (e) {
      contentObj = { text: result.content };
    }

    res.json({
      ok: true,
      code,
      text: contentObj.text || null,
      image: contentObj.image || null,
      mime: result.mime,
      remaining: result.remaining,
      total: result.total,
      deleted: result.deleted,
    });
  } catch (err) {
    console.error('extract error:', err);
    res.status(500).json({ ok: false, msg: '查询失败，请稍后再试' });
  }
});

// ---- 页面: 提取留言 (HTML，直接访问 /e/CODE 即可查看) ----
app.get('/e/:code', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    let { code } = req.params;
    code = String(code).toUpperCase().replace(/\s+/g, '');

    if (!db.validateCodeFormat(code)) {
      return res.status(400).send(htmlError('验证码格式错误'));
    }
    if (!db.verifyCode(code)) {
      return res.status(400).send(htmlError('验证码校验错误'));
    }

    const result = await db.recordExtraction(code, ip);

    if (result.error === 'expired') {
      return res.status(410).send(htmlError('该验证码已过期'));
    }
    if (result.error === 'not_found') {
      return res.status(404).send(htmlError('验证码无效或已被提取'));
    }

    let contentObj = {};
    try {
      contentObj = JSON.parse(result.content);
    } catch (e) {
      contentObj = { text: result.content };
    }

    let contentHtml = '';
    if (contentObj.text) {
      contentHtml += `<div style="margin-bottom:12px;"><strong style="color:#aaa;font-size:13px;">留言内容：</strong><pre style="white-space:pre-wrap;font-size:15px;line-height:1.6;margin-top:8px;">${escapeHtml(contentObj.text)}</pre></div>`;
    }
    if (contentObj.image) {
      contentHtml += `<div><img src="${contentObj.image}" alt="二维码" style="max-width:120px;max-height:120px;border:1px solid #444;border-radius:4px;background:#111;" /></div>`;
    }
    if (!contentObj.text && !contentObj.image) {
      contentHtml = '<p style="color:#666;">（无内容）</p>';
    }

    const statusHtml = result.deleted
      ? '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #333;color:#ff6b6b;font-size:13px;">⚠️ 该消息已耗尽，自动删除</div>'
      : `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #333;color:#888;font-size:13px;">剩余可提取次数: ${result.remaining}</div>`;

    res.send(htmlPage(code, contentHtml + statusHtml));
  } catch (err) {
    console.error('extract page error:', err);
    res.status(500).send(htmlError('查询失败'));
  }
});

function htmlError(msg) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>开信</title><style>body{font-family:system-ui,sans-serif;background:#0a0e1a;color:#e0e0e0;display:flex;height:100vh;align-items:center;justify-content:center;margin:0}div{text-align:center}</style></head><body><div><h2>${msg}</h2></div></body></html>`;
}

function htmlPage(code, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>开信 · ${code}</title>
<style>
body{font-family:'PingFang SC',system-ui,sans-serif;background:#0a0e1a;color:#e0e0e0;margin:0;padding:24px}
.container{max-width:560px;margin:0 auto}
h1{font-size:20px;margin-bottom:16px;font-weight:600}
.label{color:#888;font-size:13px;margin-bottom:12px}
.content{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px}
code{font-family:monospace;font-size:18px;color:#ff4d8a;letter-spacing:0.08em}
</style>
</head>
<body>
<div class="container">
<h1>🔍 留言内容</h1>
<div class="label">验证码: <code>${code}</code></div>
<div class="content">${bodyHtml}</div>
<p style="margin-top:24px;color:#555;font-size:12px;">开信 · 一码开信，消息即达</p>
</div>
</body>
</html>`;
}

const server = app.listen(PORT, () => {
  console.log('=');
  console.log('开信网站已启动');
  console.log('本地访问: http://localhost:' + PORT);
  console.log('=');
});

module.exports = app;