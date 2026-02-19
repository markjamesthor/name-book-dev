import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_PORT = 8797;
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

await page.screenshot({ path: '/tmp/action-btn-position.png' });

// 하단 영역만 확대 캡처
const slide = page.locator('.carousel-slide').nth(1);
const box = await slide.boundingBox();
if (box) {
  await page.screenshot({
    path: '/tmp/action-btn-closeup.png',
    clip: { x: box.x, y: box.y + box.height * 0.7, width: box.width, height: box.height * 0.3 + 80 },
  });
}

await browser.close();
server.close();
console.log('Done');
