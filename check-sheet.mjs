import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});
const page = await ctx.newPage();
await page.goto('http://localhost:3000/automation-prototype/book-preview.html?name=도현');
await page.waitForTimeout(2000);

// 1. 초기 상태
await page.screenshot({ path: '/tmp/guide-1-before.png' });
console.log('1. Initial state');

// 2. 가이드 버튼 클릭 → 모달 열기
await page.click('#guide-btn');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/guide-2-open.png' });
console.log('2. Modal opened');

// 3. 콘텐츠 스크롤
await page.evaluate(() => {
  document.getElementById('guide-modal-body').scrollTop = 300;
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/guide-3-scrolled.png' });
console.log('3. Content scrolled');

// 4. X 버튼으로 닫기
await page.click('#guide-modal-close');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/guide-4-closed.png' });
console.log('4. Modal closed');

// 5. 다시 열기
await page.click('#guide-btn');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/guide-5-reopen.png' });
console.log('5. Modal reopened');

await browser.close();
console.log('Done!');
