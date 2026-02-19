import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
await page.goto('http://localhost:8765/book-preview.html', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

// 1. 시작: 커버 페이지
await page.screenshot({ path: '/tmp/swipe-1-cover.png' });

// 2. 썸네일로 페이지 5로 이동
await page.click('[data-step="1"]');
await page.waitForTimeout(300);
const thumbs = await page.$$('.thumb');
if (thumbs.length > 5) {
  await thumbs[5].click();
  await page.waitForTimeout(800);
}
await page.screenshot({ path: '/tmp/swipe-2-page5.png' });

// 3. 스와이프로 왼쪽(이전 페이지)으로 이동 시도
const viewer = await page.$('#page-viewer');
const box = await viewer.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// 스와이프 오른쪽 (이전 페이지로)
for (let i = 0; i < 3; i++) {
  await page.touchscreen.tap(cx, cy); // normalize pending
  await page.waitForTimeout(100);

  // 터치 스와이프 시뮬레이션
  await page.evaluate(({ sx, sy, ex, ey }) => {
    const el = document.getElementById('page-viewer');
    const opts = { bubbles: true, cancelable: true };

    el.dispatchEvent(new TouchEvent('touchstart', {
      ...opts,
      touches: [new Touch({ identifier: 0, target: el, clientX: sx, clientY: sy })],
      changedTouches: [new Touch({ identifier: 0, target: el, clientX: sx, clientY: sy })]
    }));

    // 여러 프레임에 걸쳐 move
    setTimeout(() => {
      el.dispatchEvent(new TouchEvent('touchmove', {
        ...opts,
        touches: [new Touch({ identifier: 0, target: el, clientX: sx + (ex-sx)*0.3, clientY: sy })],
        changedTouches: [new Touch({ identifier: 0, target: el, clientX: sx + (ex-sx)*0.3, clientY: sy })]
      }));
    }, 16);
    setTimeout(() => {
      el.dispatchEvent(new TouchEvent('touchmove', {
        ...opts,
        touches: [new Touch({ identifier: 0, target: el, clientX: sx + (ex-sx)*0.7, clientY: sy })],
        changedTouches: [new Touch({ identifier: 0, target: el, clientX: sx + (ex-sx)*0.7, clientY: sy })]
      }));
    }, 32);
    setTimeout(() => {
      el.dispatchEvent(new TouchEvent('touchend', {
        ...opts,
        touches: [],
        changedTouches: [new Touch({ identifier: 0, target: el, clientX: ex, clientY: sy })]
      }));
    }, 50);
  }, { sx: cx - 50, sy: cy, ex: cx + 120, ey: cy });

  await page.waitForTimeout(600);
}

await page.screenshot({ path: '/tmp/swipe-3-after-swipes.png' });

// 4. 페이지 카운터 확인
const counter = await page.$eval('#page-counter', el => el.textContent);
console.log('Page counter after 3 right swipes:', counter);

// 5. 콘솔 에러 확인
page.on('console', msg => {
  if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
});

// 6. 스크린샷: 현재 상태에서 step-bar와 bottom-panel 높이 비교
// Step 0 → Step 1 → Step 2 전환 시 레이아웃 변화 확인
await page.click('[data-step="0"]');
await page.waitForTimeout(200);
const step0Height = await page.$eval('.bottom-panel', el => el.getBoundingClientRect().height);
await page.screenshot({ path: '/tmp/swipe-4-step0-layout.png' });

await page.click('[data-step="1"]');
await page.waitForTimeout(200);
const step1Height = await page.$eval('.bottom-panel', el => el.getBoundingClientRect().height);
await page.screenshot({ path: '/tmp/swipe-5-step1-layout.png' });

await page.click('[data-step="2"]');
await page.waitForTimeout(200);
const step2Height = await page.$eval('.bottom-panel', el => el.getBoundingClientRect().height);
await page.screenshot({ path: '/tmp/swipe-6-step2-layout.png' });

console.log(`Bottom panel heights — Step0: ${step0Height}px, Step1: ${step1Height}px, Step2: ${step2Height}px`);

// 7. 뷰어 높이 비교
await page.click('[data-step="0"]');
await page.waitForTimeout(200);
const viewer0 = await page.$eval('#page-viewer', el => el.getBoundingClientRect().height);

await page.click('[data-step="1"]');
await page.waitForTimeout(200);
const viewer1 = await page.$eval('#page-viewer', el => el.getBoundingClientRect().height);

await page.click('[data-step="2"]');
await page.waitForTimeout(200);
const viewer2 = await page.$eval('#page-viewer', el => el.getBoundingClientRect().height);

console.log(`Viewer heights — Step0: ${viewer0}px, Step1: ${viewer1}px, Step2: ${viewer2}px`);

await browser.close();
