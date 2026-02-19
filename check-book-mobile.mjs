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

// iPhone 14 Pro
const mobile = await browser.newPage({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
});

await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(1000);

// Shot 1: mobile initial (page 0)
await mobile.screenshot({ path: '/tmp/book-mobile-1-page0.png' });
console.log('Shot 1: mobile page 0');

// Shot 2: navigate to illustration page (page 4)
for (let i = 0; i < 4; i++) {
  await mobile.click('#m-btn-next');
  await mobile.waitForTimeout(500);
}
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: '/tmp/book-mobile-2-page4.png' });
console.log('Shot 2: mobile page 4');

// Shot 3: open settings sheet
await mobile.click('#btn-settings');
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: '/tmp/book-mobile-3-settings.png' });
console.log('Shot 3: settings open');

// Shot 4: change name, close settings
await mobile.fill('#m-input-firstName', '하은');
await mobile.waitForTimeout(200);
await mobile.click('#settings-backdrop');
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: '/tmp/book-mobile-4-name-changed.png' });
console.log('Shot 4: name changed');

// Shot 5: switch to B version
const versionBtns = await mobile.$$('.mobile-version-bar .version-btn');
if (versionBtns.length >= 2) {
  await versionBtns[1].click();
  await mobile.waitForTimeout(500);
}
await mobile.screenshot({ path: '/tmp/book-mobile-5-version-b.png' });
console.log('Shot 5: B version');

// Also take a desktop screenshot to ensure it still works
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await desktop.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await desktop.waitForTimeout(800);
// Navigate to page 4
for (let i = 0; i < 4; i++) {
  await desktop.click('#btn-next');
  await desktop.waitForTimeout(500);
}
await desktop.waitForTimeout(300);
await desktop.screenshot({ path: '/tmp/book-desktop-check.png' });
console.log('Shot 6: desktop check');

await browser.close();
server.close();
console.log('Done');
