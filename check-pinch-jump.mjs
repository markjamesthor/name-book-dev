import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_PORT = 8798;
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

page.on('console', msg => console.log(`[browser] ${msg.text()}`));

await page.goto(`http://localhost:${STATIC_PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

await page.locator('#cover-photo-input').setInputFiles(IMG);
console.log('사진 업로드 완료');

await page.waitForSelector('.cover-child-img', { timeout: 120000 });
await page.waitForTimeout(40000);
console.log('배경 제거 완료');

// CSS transform에서 실제 위치 파싱
const getSlideTransform = () => page.evaluate(() => {
  const wrap = document.querySelector('.slide-img-wrap');
  if (!wrap) return null;
  return wrap.style.transform || getComputedStyle(wrap).transform;
});

await page.screenshot({ path: '/tmp/pinch-01-initial.png' });

const cx = 195, cy = 400;
const spread = 80;

// --- 테스트 1: 핀치 줌 → 한 손가락 떼기 → 나머지 손가락으로 패닝 ---
console.log('\n=== 테스트 1: 핀치→1-finger 전환 ===');

// 핀치 줌 (2 fingers spread)
await page.evaluate(async ({ cx, cy, spread }) => {
  const el = document.querySelector('.carousel-track') || document.elementFromPoint(cx, cy);
  const mkTouch = (id, x, y) => new Touch({ identifier: id, target: el, clientX: x, clientY: y });

  el.dispatchEvent(new TouchEvent('touchstart', {
    bubbles: true, cancelable: true,
    touches: [mkTouch(1, cx - 20, cy), mkTouch(2, cx + 20, cy)],
    changedTouches: [mkTouch(1, cx - 20, cy), mkTouch(2, cx + 20, cy)],
  }));
  await new Promise(r => setTimeout(r, 50));

  for (let i = 1; i <= 10; i++) {
    const offset = 20 + spread * i / 10;
    el.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true, cancelable: true,
      touches: [mkTouch(1, cx - offset, cy), mkTouch(2, cx + offset, cy)],
      changedTouches: [mkTouch(1, cx - offset, cy), mkTouch(2, cx + offset, cy)],
    }));
    await new Promise(r => setTimeout(r, 30));
  }
}, { cx, cy, spread });

await page.waitForTimeout(200);
const transformAfterPinch = await getSlideTransform();
console.log('핀치 줌 후 transform:', transformAfterPinch);
await page.screenshot({ path: '/tmp/pinch-02-zoomed.png' });

// 한 손가락 떼기 (finger2 lifts, finger1 remains)
await page.evaluate(async ({ cx, cy }) => {
  const el = document.querySelector('.carousel-track') || document.elementFromPoint(cx, cy);
  const mkTouch = (id, x, y) => new Touch({ identifier: id, target: el, clientX: x, clientY: y });

  el.dispatchEvent(new TouchEvent('touchend', {
    bubbles: true, cancelable: true,
    touches: [mkTouch(1, cx - 100, cy)],
    changedTouches: [mkTouch(2, cx + 100, cy)],
  }));
}, { cx, cy });

await page.waitForTimeout(100);
const transformAfterLift = await getSlideTransform();
console.log('손가락 1개 뗀 후 transform:', transformAfterLift);

// 남은 손가락(finger1)으로 약간 이동
const panResults = await page.evaluate(async ({ cx, cy }) => {
  const el = document.querySelector('.carousel-track') || document.elementFromPoint(cx, cy);
  const mkTouch = (id, x, y) => new Touch({ identifier: id, target: el, clientX: x, clientY: y });
  const wrap = document.querySelector('.slide-img-wrap');

  const results = [];

  // 각 이동 단계마다 transform 기록
  for (let i = 1; i <= 5; i++) {
    el.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true, cancelable: true,
      touches: [mkTouch(1, cx - 100 + i * 5, cy + i * 3)],
      changedTouches: [mkTouch(1, cx - 100 + i * 5, cy + i * 3)],
    }));
    await new Promise(r => setTimeout(r, 50));
    results.push(wrap ? wrap.style.transform : 'none');
  }

  el.dispatchEvent(new TouchEvent('touchend', {
    bubbles: true, cancelable: true,
    touches: [],
    changedTouches: [mkTouch(1, cx - 75, cy + 15)],
  }));

  return results;
}, { cx, cy });

console.log('팬 단계별 transform:', panResults);
await page.screenshot({ path: '/tmp/pinch-03-after-pan.png' });

// transform 변화 분석: 점프 감지
// transform 문자열에서 translate 값 추출
function parseTranslate(t) {
  if (!t) return null;
  // scale(X) translate(Ypx, Zpx) 형태
  const m = t.match(/translate\(([-.0-9]+)px,\s*([-.0-9]+)px\)/);
  if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  return null;
}

const prevPos = parseTranslate(transformAfterLift);
if (prevPos && panResults.length > 0) {
  const firstPanPos = parseTranslate(panResults[0]);
  if (firstPanPos) {
    const jumpX = Math.abs(firstPanPos.x - prevPos.x);
    const jumpY = Math.abs(firstPanPos.y - prevPos.y);
    console.log(`\n첫 팬 이동 변화: dx=${jumpX.toFixed(1)}px, dy=${jumpY.toFixed(1)}px`);
    if (jumpX < 30 && jumpY < 30) {
      console.log('✅ 점프 없음! 부드러운 전환 성공');
    } else {
      console.log('❌ 점프 발생! 변화량이 너무 큼');
    }
  } else {
    console.log('첫 팬 결과 파싱 불가:', panResults[0]);
  }
} else {
  console.log('transform 파싱 불가');
  console.log('prevPos:', transformAfterLift);
  console.log('panResults:', panResults);
}

await browser.close();
server.close();
console.log('\nDone');
