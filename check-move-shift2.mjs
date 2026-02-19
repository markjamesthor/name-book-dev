import { chromium } from 'playwright';
import path from 'path';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:8080/book-preview.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const fileInput = await page.$('#cover-photo-input');
await fileInput.setInputFiles(path.resolve('automation-prototype/NAME/IMG_7974.PNG'));
await page.waitForSelector('.cover-child-img', { timeout: 60000 });
await page.waitForTimeout(1000);

// 버튼 영역 확대 캡처
const menu = await page.$('.cover-action-menu');
const box = await menu.boundingBox();
await page.screenshot({
  path: '/tmp/action-btn.png',
  clip: { x: 0, y: box.y - 60, width: 390, height: 120 },
});

// 전체 스크린샷
await page.screenshot({ path: '/tmp/cover-full.png' });

await browser.close();
console.log('Done');
