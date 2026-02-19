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

async function injectToggle(page) {
  await page.evaluate(() => {
    const slides = document.querySelectorAll('.carousel-slide');
    const center = slides[1];
    if (!center) return;
    center.insertAdjacentHTML('beforeend', `<div class="model-toggle-wrap">
      <div class="model-toggle-hint">배경이 가장 잘 지워진 사진을 골라주세요</div>
      <div class="model-toggle">
        <div class="model-toggle-option active" data-model="portrait">1</div>
        <div class="model-toggle-option" data-model="ben2">2</div>
        <div class="model-toggle-option" data-model="hr-matting">3</div>
      </div>
    </div>`);
  });
  await page.waitForTimeout(300);
}

// Desktop
const d = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await d.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await d.waitForTimeout(1500);
await injectToggle(d);
await d.screenshot({ path: '/tmp/toggle-hint-desktop.png' });
console.log('1: Desktop');

// Mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await m.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await m.waitForTimeout(1500);
await injectToggle(m);
await m.screenshot({ path: '/tmp/toggle-hint-mobile.png' });
console.log('2: Mobile');

await browser.close();
server.close();
console.log('Done');
