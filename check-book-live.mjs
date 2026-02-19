import { chromium } from 'playwright';

const URL = 'https://markjamesthor.github.io/name-book-preview/book-preview.html';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

await page.screenshot({ path: '/tmp/book-live-page0.png', fullPage: false });
console.log('Shot 1: live A-page0');

// Navigate to illustration page
for (let i = 0; i < 4; i++) {
  await page.click('#btn-next');
  await page.waitForTimeout(300);
}
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/book-live-page4.png', fullPage: false });
console.log('Shot 2: live A-page4');

await browser.close();
console.log('Done');
