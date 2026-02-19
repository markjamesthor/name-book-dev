import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8799;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(__dirname, urlPath);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise(resolve => server.listen(PORT, resolve));
console.log(`Server on http://localhost:${PORT}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);

// Screenshot 1: A version, page 0 (프롤로그)
await page.screenshot({ path: '/tmp/book-preview-A-page0.png', fullPage: false });
console.log('Shot 1: A-page0');

// Navigate to page 4 (그림자의 습격 — illustration)
for (let i = 0; i < 4; i++) {
  await page.click('#btn-next');
  await page.waitForTimeout(200);
}
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/book-preview-A-page4.png', fullPage: false });
console.log('Shot 2: A-page4');

// Change name → 지수
await page.fill('#input-firstName', '지수');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/book-preview-A-name-change.png', fullPage: false });
console.log('Shot 3: name=지수');

// Switch to B version
await page.click('[data-version="B"]');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/book-preview-B-page0.png', fullPage: false });
console.log('Shot 4: B-page0');

// B-7 이름의 탄생 = index 6
const thumbs = await page.$$('.thumb');
if (thumbs.length >= 7) {
  await thumbs[6].click();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: '/tmp/book-preview-B-nameLetters.png', fullPage: false });
console.log('Shot 5: B-nameLetters');

await browser.close();
server.close();
console.log('Done — screenshots in /tmp/book-preview-*.png');
