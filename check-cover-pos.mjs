import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8805;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
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

const browser = await chromium.launch();

// ===== Desktop =====
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('console', msg => {
  const t = msg.text();
  if (t.includes('크롭') || t.includes('키포인트') || t.includes('스마트') || t.includes('position')) console.log(`[B] ${t}`);
});

await page.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);

// Shot 1: 커버 (업로드 전) — golden_star 배경
await page.screenshot({ path: '/tmp/pos-1-cover-before.png', fullPage: false });
console.log('Shot 1: cover before upload');

// Upload photo
await page.locator('#cover-photo-input').setInputFiles(path.join(__dirname, 'test_images/IMG_5602.jpg'));
console.log('Uploading...');

// Wait for result
await page.waitForFunction(() => document.querySelector('.cover-child-img') !== null, { timeout: 90000 });
await page.waitForTimeout(500);

// Shot 2: 커버 (아이 배치 결과)
await page.screenshot({ path: '/tmp/pos-2-cover-result.png', fullPage: false });
console.log('Shot 2: cover result with positioned child');

// Shot 3: 다음 페이지로 이동해서 정상 동작 확인
await page.click('#btn-next');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/pos-3-page1.png', fullPage: false });
console.log('Shot 3: page 1');

// ===== Mobile =====
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(1000);

// Shot 4: 모바일 커버
await mobile.screenshot({ path: '/tmp/pos-4-mobile-cover.png', fullPage: false });
console.log('Shot 4: mobile cover');

// Upload on mobile
await mobile.locator('#cover-photo-input').setInputFiles(path.join(__dirname, 'test_images/IMG_5602.jpg'));
await mobile.waitForFunction(() => document.querySelector('.cover-child-img') !== null, { timeout: 90000 });
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: '/tmp/pos-5-mobile-result.png', fullPage: false });
console.log('Shot 5: mobile result');

await browser.close();
server.close();
console.log('Done');
