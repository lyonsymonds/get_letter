#!/usr/bin/env node
// Test script to verify the API works
const http = require('http');
const { spawn } = require('child_process');

const port = 3000;
const baseUrl = 'http://localhost:' + port;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: path,
      method: method,
      headers: {}
    };
    if (body) {
      body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('Starting API tests...\n');
  try {
    // Test 1: Create a once-type message
    console.log('--- Test 1: Create once-type message ---');
    const createRes = await request('POST', '/api/create', {
      content: '测试留言: 开信系统测试',
      mime: 'text',
      type: 'once',
      maxUses: 1
    });
    if (createRes.statusCode === 200 && createRes.data.ok) {
      console.log('✓ Create successful');
      console.log('Code:', createRes.data.code);
      console.log('Expires:', createRes.data.expiresAt);
      console.log('Type:', createRes.data.type);
      const code = createRes.data.code;
      // Test 2: Extract the message
      console.log('\n--- Test 2: Extract message ---');
      const extractRes = await request('GET', '/api/e/' + code);
      if (extractRes.statusCode === 200 && extractRes.data.ok) {
        console.log('✓ Extract successful');
        console.log('Content:', extractRes.data.content.substring(0, 30) + '...');
        console.log('Remaining:', extractRes.data.remaining);
        console.log('Deleted:', extractRes.data.deleted);
      } else {
        console.log('✗ Extract failed:', extractRes.statusCode, extractRes.data.msg);
      }
      // Test 3: Try extracting again (should fail - one-time)
      console.log('\n--- Test 3: Extract again (should fail) ---');
      const extractRes2 = await request('GET', '/api/e/' + code);
      if (!extractRes2.data.ok) {
        console.log('✓ Correctly rejected as', extractRes2.data.msg);
      } else {
        console.log('✗ Should have failed but succeeded');
      }
    } else {
      console.log('✗ Create failed:', createRes.statusCode, createRes.data.msg);
    }
    // Test 4: Create a repeat-type message
    console.log('\n--- Test 4: Create repeat-type message ---');
    const createRes2 = await request('POST', '/api/create', {
      content: '测试重复留言: 重复系统测试',
      mime: 'text',
      type: 'repeat',
      maxUses: 5
    });
    if (createRes2.statusCode === 200 && createRes2.data.ok) {
      console.log('✓ Repeat create successful');
      console.log('Code:', createRes2.data.code);
    } else {
      console.log('✗ Repeat create failed:', createRes2.statusCode, createRes2.data.msg);
    }
    // Test 5: Invalid code format
    console.log('\n--- Test 5: Invalid code format ---');
    const invalidRes = await request('GET', '/api/e/123');
    if (invalidRes.statusCode === 400) {
      console.log('✓ Correctly rejected invalid code');
    } else {
      console.log('✗ Should have rejected invalid code');
    }
  } catch (e) {
    console.log('✗ Error:', e.message);
  }
  console.log('\n--- Tests completed ---');
  process.exit(0);
}

// Wait for server to be ready
async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await request('GET', '/');
      if (res.statusCode === 200) {
        console.log('Server is ready!');
        await runTests();
        return;
      }
    } catch (e) { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('Server not ready after 15s');
  process.exit(1);
}

// Spawn the server
const server = spawn('node', ['server.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: __dirname
});

server.stdout.on('data', (data) => {
  process.stdout.write(data);
});

server.stderr.on('data', (data) => {
  process.stderr.write(data);
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Wait for server to start, then run tests
setTimeout(() => {
  waitForServer().then(() => {
    server.kill();
    process.exit(0);
  });
}, 2000);