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
  '.ttf': 'font/ttf', '.otf': 'font/otf',
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

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(1000);

// Cover page
await mobile.screenshot({ path: '/tmp/size-cover.png', fullPage: false });
console.log('Shot 1: Cover');

// Navigate to page 2 (일반 페이지)
await mobile.click('#m-btn-next');
await mobile.waitForTimeout(400);
await mobile.click('#m-btn-next');
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: '/tmp/size-page2.png', fullPage: false });
console.log('Shot 2: Page 2');

// Desktop
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await desktop.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await desktop.waitForTimeout(1000);
await desktop.screenshot({ path: '/tmp/size-desktop-cover.png', fullPage: false });
console.log('Shot 3: Desktop cover');

await desktop.click('#btn-next');
await desktop.waitForTimeout(400);
await desktop.click('#btn-next');
await desktop.waitForTimeout(400);
await desktop.screenshot({ path: '/tmp/size-desktop-page2.png', fullPage: false });
console.log('Shot 4: Desktop page 2');

await browser.close();
server.close();
console.log('Done');
