import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8799;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.webp':'image/webp' };

const server = createServer(async (req, res) => {
  const filePath = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
  try { const data = await readFile(filePath); const ext = path.extname(filePath).toLowerCase(); res.writeHead(200, {'Content-Type': MIME[ext]||'application/octet-stream'}); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch();

// Mobile
const mobile = await browser.newPage({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
});
await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(1000);

// Navigate to page 3 so page 3 thumb is active
for (let i = 0; i < 3; i++) {
  await mobile.click('#m-btn-next');
  await mobile.waitForTimeout(500);
}
await mobile.waitForTimeout(300);

// Screenshot the thumbnail strip area only
const thumbBar = await mobile.$('.thumbnail-bar');
await thumbBar.screenshot({ path: '/tmp/thumb-mobile-crop.png' });
console.log('Shot 1: mobile thumbnail bar cropped');

// Full page for context
await mobile.screenshot({ path: '/tmp/thumb-mobile-full.png' });
console.log('Shot 2: mobile full');

// Desktop too
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await desktop.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await desktop.waitForTimeout(800);
for (let i = 0; i < 3; i++) {
  await desktop.click('#btn-next');
  await desktop.waitForTimeout(500);
}
await desktop.waitForTimeout(300);

const dThumbBar = await desktop.$('.thumbnail-bar');
await dThumbBar.screenshot({ path: '/tmp/thumb-desktop-crop.png' });
console.log('Shot 3: desktop thumbnail bar cropped');

await browser.close();
server.close();
console.log('Done');
