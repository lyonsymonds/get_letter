#!/usr/bin/env node
// Quick test of the API
const http = require('http');
const { spawn } = require('child_process');

const server = spawn('node', ['server.js'], { stdio: 'pipe', cwd: __dirname });
server.stdout.on('data', (d) => process.stdout.write(d));
server.stderr.on('data', (d) => process.stderr.write(d));

const req = (method, path, body) => new Promise((res, rej) => {
  const o = { hostname: 'localhost', port: 3000, path, method, headers: {} };
  if (body) { body = JSON.stringify(body); o.headers['Content-Type'] = 'application/json'; o.headers['Content-Length'] = Buffer.byteLength(body); }
  const r = http.request(o, (s) => { let d = ''; s.on('data', c => d += c); s.on('end', () => res({ status: s.statusCode, data: d })); });
  r.on('error', rej); if (body) r.write(body); r.end();
});

setTimeout(async () => {
  try {
    // Test create (text+image mixed)
    const c1 = await req('POST', '/api/create', { text: '测试文字', image: 'data:image/png;base64,abc', type: 'once', maxUses: 1 });
    console.log('Create mixed:', c1.status, JSON.parse(c1.data).ok ? 'OK' : 'FAIL');
    const code = JSON.parse(c1.data).code;

    // Test extract
    const e1 = await req('GET', '/api/e/' + code);
    const d1 = JSON.parse(e1.data);
    console.log('Extract mixed:', e1.status, d1.ok ? 'OK' : 'FAIL', 'text:', d1.text, 'image:', d1.image ? 'yes' : 'no');

    // Test create (text only)
    const c2 = await req('POST', '/api/create', { text: '纯文字留言', image: null, type: 'repeat', maxUses: 3 });
    console.log('Create text:', c2.status, JSON.parse(c2.data).ok ? 'OK' : 'FAIL');
    const code2 = JSON.parse(c2.data).code;

    // Test extract text
    const e2 = await req('GET', '/api/e/' + code2);
    const d2 = JSON.parse(e2.data);
    console.log('Extract text:', e2.status, d2.ok ? 'OK' : 'FAIL', 'text:', d2.text ? d2.text.substring(0, 30) : 'none');

    // Test HTML page /e/:code
    const p1 = await req('GET', '/e/' + code2);
    console.log('HTML page:', p1.status, p1.data.includes('留言内容') ? 'OK' : 'FAIL');

    console.log('\nAll tests done!');
  } catch (e) { console.error('Error:', e.message); }
  server.kill(); process.exit(0);
}, 2000);