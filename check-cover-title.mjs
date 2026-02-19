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

// Desktop
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/cover-title-desktop.png', fullPage: false });

const slide = await page.$('.carousel-slide:nth-child(2)');
if (slide) await slide.screenshot({ path: '/tmp/cover-title-slide-zoom.png' });

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(1000);
await mobile.screenshot({ path: '/tmp/cover-title-mobile.png', fullPage: false });

await browser.close();
server.close();
console.log('Done');
