import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8801;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(__dirname, urlPath);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise(resolve => server.listen(PORT, resolve));
console.log(`Server on http://localhost:${PORT}`);

const browser = await chromium.launch();

// Desktop
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);

// Screenshot 1: Cover page (desktop)
await page.screenshot({ path: '/tmp/cover-desktop.png', fullPage: false });
console.log('Shot 1: cover-desktop');

// Navigate to page 1 (프롤로그) to check it still works
await page.click('#btn-next');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/cover-desktop-page1.png', fullPage: false });
console.log('Shot 2: page1-after-cover');

// Go back to cover
await page.click('#btn-prev');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/cover-desktop-back.png', fullPage: false });
console.log('Shot 3: back-to-cover');

// Switch version B, cover should still be there
await page.click('.left-panel [data-version="B"]');
await page.waitForTimeout(500);
// Go to cover (first thumb)
const thumbs = await page.$$('.thumb');
if (thumbs.length > 0) {
  await thumbs[0].click();
  await page.waitForTimeout(400);
}
await page.screenshot({ path: '/tmp/cover-desktop-B.png', fullPage: false });
console.log('Shot 4: cover-version-B');

// Mobile
const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobilePage.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobilePage.waitForTimeout(1000);
await mobilePage.screenshot({ path: '/tmp/cover-mobile.png', fullPage: false });
console.log('Shot 5: cover-mobile');

await browser.close();
server.close();
console.log('Done — screenshots in /tmp/cover-*.png');
