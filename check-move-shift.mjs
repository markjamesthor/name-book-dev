import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_PORT = 8796;
const IMG = path.join(__dirname, 'NAME/IMG_7974.PNG');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(__dirname, urlPath);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(STATIC_PORT, resolve));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
const page = await context.newPage();

await page.goto(`http://localhost:${STATIC_PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

await page.locator('#cover-photo-input').setInputFiles(IMG);
console.log('사진 업로드 완료');

await page.waitForSelector('.cover-child-img', { timeout: 120000 });
await page.waitForTimeout(40000);
console.log('배경 제거 완료');

// 위치 변경 전 스크린샷
await page.screenshot({ path: '/tmp/move-01-before.png' });

// slide-img-wrap 위치 기록
const beforeRect = await page.evaluate(() => {
  const wrap = document.querySelector('.slide-img-wrap');
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  return { top: r.top, height: r.height };
});
console.log('변경 전 slide-img-wrap:', beforeRect);

// 위치 변경 클릭
await page.click('.cover-action-btn[data-action="move"]');
await page.waitForTimeout(500);

// 위치 변경 후 스크린샷
await page.screenshot({ path: '/tmp/move-02-after.png' });

const afterRect = await page.evaluate(() => {
  const wrap = document.querySelector('.slide-img-wrap');
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  return { top: r.top, height: r.height };
});
console.log('변경 후 slide-img-wrap:', afterRect);

if (beforeRect && afterRect) {
  const shift = afterRect.top - beforeRect.top;
  console.log(`이미지 위치 변화: ${shift.toFixed(1)}px`);
  if (Math.abs(shift) < 2) {
    console.log('✅ 위치 변화 없음');
  } else {
    console.log('❌ 위치 변화 발생!');
  }
}

await browser.close();
server.close();
console.log('Done');
