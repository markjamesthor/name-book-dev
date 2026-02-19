import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8799;
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
await new Promise(resolve => server.listen(PORT, resolve));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  recordVideo: { dir: '/tmp/glitch-video/', size: { width: 780, height: 1688 } }
});
const page = await context.newPage();
await page.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// Forward 2 pages
await page.click('#m-btn-next');
await page.waitForTimeout(600);
await page.click('#m-btn-next');
await page.waitForTimeout(600);

// Take screenshot at page 2
await page.screenshot({ path: '/tmp/glitch-at-page2.png' });

// Go back 1 page
await page.click('#m-btn-prev');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/glitch-back-to-page1.png' });

// Go back to cover
await page.click('#m-btn-prev');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/glitch-back-to-cover.png' });

// Rapid forward/backward 8 times
for (let i = 0; i < 8; i++) {
  await page.click('#m-btn-next');
  await page.waitForTimeout(500);
  await page.click('#m-btn-prev');
  await page.waitForTimeout(500);
}

await page.screenshot({ path: '/tmp/glitch-after-rapid.png' });

// Verify track state
const state = await page.evaluate(() => {
  const track = document.getElementById('carousel-track');
  if (!track) return null;
  const slides = Array.from(track.children);
  return {
    transform: getComputedStyle(track).transform,
    slideCount: slides.length,
    slides: slides.map(s => ({
      pageIndex: s.dataset.pageIndex,
      rect: s.getBoundingClientRect()
    }))
  };
});
console.log('Track state after rapid test:', JSON.stringify(state, null, 2));

await context.close();
await browser.close();
server.close();
console.log('Done');
