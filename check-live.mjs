import { chromium } from 'playwright';

const URL = 'https://markjamesthor.github.io/name-book-dev/book-preview.html';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/live-cover-desktop.png', fullPage: false });
console.log('Desktop OK');

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(1500);
await mobile.screenshot({ path: '/tmp/live-cover-mobile.png', fullPage: false });
console.log('Mobile OK');

await browser.close();
console.log('Done');
