import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'https://markjamesthor.github.io/name-book-dev/book-preview.html';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

// Capture console logs
page.on('console', msg => {
  const text = msg.text();
  if (text.includes('스마트') || text.includes('크롭') || text.includes('배경') || text.includes('smart') || text.includes('fallback') || text.includes('스킵')) {
    console.log(`[BROWSER] ${text}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

// Shot 1: Cover page
await page.screenshot({ path: '/tmp/live2-cover.png', fullPage: false });
console.log('Shot 1: cover page');

// Upload test photo
const fileInput = page.locator('#cover-photo-input');
await fileInput.setInputFiles(path.join(__dirname, 'test_images/IMG_5602.jpg'));
console.log('File uploaded, waiting...');

// Shot 2: Loading state
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/live2-loading.png', fullPage: false });
console.log('Shot 2: loading');

// Wait for result
await page.waitForFunction(() => {
  const img = document.querySelector('.cover-photo-img');
  return img !== null;
}, { timeout: 90000 });
await page.waitForTimeout(500);

// Shot 3: Result
await page.screenshot({ path: '/tmp/live2-result.png', fullPage: false });
console.log('Shot 3: result');

await browser.close();
console.log('Done');
