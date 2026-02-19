import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

const ROOT = '/tmp/deploy-check/automation-prototype';
const PORT = 8802;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(ROOT, urlPath);
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
console.log(`Serving DEPLOYED code from ${ROOT}`);

const browser = await chromium.launch();

// Desktop
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/deployed-cover-desktop.png', fullPage: false });
console.log('Desktop cover OK');

// Next → 프롤로그
await page.click('#btn-next');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/deployed-page1-desktop.png', fullPage: false });
console.log('Desktop page1 OK');

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(1000);
await mobile.screenshot({ path: '/tmp/deployed-cover-mobile.png', fullPage: false });
console.log('Mobile cover OK');

await browser.close();
server.close();
console.log('All deployed screenshots saved to /tmp/deployed-*.png');
