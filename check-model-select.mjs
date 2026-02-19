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

// Use a sample child image (golden_star as placeholder) + actual bg preview
const overlayHTML = `
  <div class="model-select-overlay">
    <div class="model-select-title">배경이 잘 지워진 사진을 선택하세요</div>
    <div class="model-select-grid">
      <div class="model-option" data-model="portrait">
        <div class="model-preview-wrap">
          <img class="model-preview-bg" src="NAME/golden_star.webp" alt="bg" />
          <img class="model-preview-child" src="NAME/golden_star.webp" style="height:120%;top:-10%;left:50%;transform:translateX(-50%)" />
        </div>
        <div class="model-option-label">Portrait</div>
      </div>
      <div class="model-option" data-model="ben2">
        <div class="model-preview-wrap">
          <img class="model-preview-bg" src="NAME/golden_star.webp" alt="bg" />
          <img class="model-preview-child" src="NAME/golden_star.webp" style="height:120%;top:-10%;left:50%;transform:translateX(-50%)" />
        </div>
        <div class="model-option-label">BEN2</div>
      </div>
    </div>
  </div>`;

async function injectToCenter(page) {
  await page.evaluate((html) => {
    const slides = document.querySelectorAll('.carousel-slide');
    const centerSlide = slides[1];
    if (!centerSlide) return;
    centerSlide.insertAdjacentHTML('beforeend', html);
  }, overlayHTML);
  await page.waitForTimeout(500);
}

// Desktop
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await desktop.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await desktop.waitForTimeout(2000);
await injectToCenter(desktop);
await desktop.screenshot({ path: '/tmp/model-select-desktop.png', fullPage: false });
console.log('Shot 1: Desktop');

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(2000);
await injectToCenter(mobile);
await mobile.screenshot({ path: '/tmp/model-select-mobile.png', fullPage: false });
console.log('Shot 2: Mobile');

await browser.close();
server.close();
console.log('Done');
