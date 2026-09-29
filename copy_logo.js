const fs = require('fs');
const path = require('path');

// 复制 logo.png 到 public 文件夹
const src = path.join(__dirname, 'logo.png');
const dst = path.join(__dirname, 'public', 'logo.png');

try {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log('✓ logo.png 复制到 public/ 成功');
  } else {
    console.log('✗ logo.png 不存在于', src);
  }
} catch (e) {
  console.error('复制失败:', e.message);
}

// 验证文件大小
if (fs.existsSync(dst)) {
  const stats = fs.statSync(dst);
  console.log('文件大小:', (stats.size / 1024).toFixed(1) + 'KB');
}
