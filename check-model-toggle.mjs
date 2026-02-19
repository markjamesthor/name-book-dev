import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_PORT = 8799;
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
console.log('사진 업로드');

await page.waitForSelector('.cover-child-img', { timeout: 120000 });
await page.waitForTimeout(40000);
console.log('모든 모델 완료');

// 현재 페이지 확인
const pageBefore = await page.evaluate(() => window.currentPageIndex ?? 'unknown');
console.log(`현재 페이지: ${pageBefore}`);

// 위치 변경 클릭
await page.click('.cover-action-btn[data-action="move"]');
await page.waitForTimeout(500);
console.log('위치 편집 모드 진입');

// 터치 드래그 시뮬레이션 (왼쪽으로 크게 스와이프 — 캐러셀이면 페이지 이동될 것)
const wrap = page.locator('.carousel-slide').nth(1).locator('.slide-img-wrap');
const box = await wrap.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

await page.touchscreen.tap(cx, cy);
await page.waitForTimeout(100);

// 터치 드래그
await page.evaluate(async ({sx, sy, ex, ey}) => {
  const el = document.elementFromPoint(sx, sy);
  el.dispatchEvent(new TouchEvent('touchstart', {
    bubbles: true, cancelable: true,
    touches: [new Touch({ identifier: 1, target: el, clientX: sx, clientY: sy })],
    changedTouches: [new Touch({ identifier: 1, target: el, clientX: sx, clientY: sy })]
  }));
  await new Promise(r => setTimeout(r, 50));
  for (let i = 1; i <= 10; i++) {
    const x = sx + (ex - sx) * i / 10;
    const y = sy + (ey - sy) * i / 10;
    el.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true, cancelable: true,
      touches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })]
    }));
    await new Promise(r => setTimeout(r, 30));
  }
  el.dispatchEvent(new TouchEvent('touchend', {
    bubbles: true, cancelable: true,
    touches: [],
    changedTouches: [new Touch({ identifier: 1, target: el, clientX: ex, clientY: ey })]
  }));
}, { sx: cx, sy: cy, ex: cx - 150, ey: cy + 30 });

await page.waitForTimeout(500);

const pageAfter = await page.evaluate(() => window.currentPageIndex ?? 'unknown');
console.log(`드래그 후 페이지: ${pageAfter}`);

await page.screenshot({ path: '/tmp/cover-drag-test.png' });

if (pageBefore === pageAfter) {
  console.log('✅ 캐러셀 스크롤 차단 성공! 페이지 변경 없음');
} else {
  console.log('❌ 캐러셀 스크롤 발생! 페이지가 변경됨');
}

await browser.close();
server.close();
console.log('Done');
