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

const mobile = await browser.newPage({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
});
await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(1000);

// Navigate to page 5
for (let i = 0; i < 5; i++) {
  await mobile.click('#m-btn-next');
  await mobile.waitForTimeout(500);
}

// Log current page info before switch
const beforeInfo = await mobile.$eval('#m-page-counter', el => el.textContent);
const beforeTitle = await mobile.$eval('#m-page-title', el => el.textContent);
console.log(`BEFORE switch: ${beforeInfo} - ${beforeTitle}`);
await mobile.screenshot({ path: '/tmp/vs-before.png' });

// Switch to B
await mobile.click('.mobile-version-bar .version-btn[data-version="B"]');
await mobile.waitForTimeout(500);

const afterInfo = await mobile.$eval('#m-page-counter', el => el.textContent);
const afterTitle = await mobile.$eval('#m-page-title', el => el.textContent);
console.log(`AFTER switch to B: ${afterInfo} - ${afterTitle}`);
await mobile.screenshot({ path: '/tmp/vs-after-B.png' });

// Switch back to A
await mobile.click('.mobile-version-bar .version-btn[data-version="A"]');
await mobile.waitForTimeout(500);

const backInfo = await mobile.$eval('#m-page-counter', el => el.textContent);
const backTitle = await mobile.$eval('#m-page-title', el => el.textContent);
console.log(`AFTER switch back to A: ${backInfo} - ${backTitle}`);
await mobile.screenshot({ path: '/tmp/vs-after-A.png' });

await browser.close();
server.close();
console.log('Done');
