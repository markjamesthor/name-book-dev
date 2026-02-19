import { chromium } from 'playwright';
import path from 'path';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:8080/book-preview.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 사진 업로드
const fileInput = await page.$('#cover-photo-input');
await fileInput.setInputFiles(path.resolve('automation-prototype/NAME/IMG_7974.PNG'));
await page.waitForSelector('.cover-child-img', { timeout: 60000 });
await page.waitForTimeout(1000);

// 1) 커버 페이지 — 초기 상태
await page.screenshot({ path: '/tmp/cover-nav-1-initial.png' });

// 2) 다음 페이지로 이동 (버튼 클릭)
await page.click('#m-btn-next');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/cover-nav-2-page1.png' });

// 3) 다시 커버로 돌아오기
await page.click('#m-btn-prev');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/cover-nav-3-back.png' });

// 4) 2페이지 건너뛰기 (썸네일 클릭으로 page 3으로)
await page.evaluate(() => {
  const thumbs = document.querySelectorAll('.thumb');
  if (thumbs[3]) thumbs[3].click();
});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/cover-nav-4-page3.png' });

// 5) 썸네일로 다시 커버로 돌아오기
await page.evaluate(() => {
  const thumbs = document.querySelectorAll('.thumb');
  if (thumbs[0]) thumbs[0].click();
});
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/cover-nav-5-back-from-3.png' });

await browser.close();
console.log('Done');
