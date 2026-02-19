import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8806;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' };

const server = createServer(async (req, res) => {
  const filePath = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
  try { const data = await readFile(filePath); const ext = path.extname(filePath).toLowerCase(); res.writeHead(200, {'Content-Type': MIME[ext]||'application/octet-stream'}); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch();

// 테스트할 사진
const testPhoto = '/Users/taehoonjth/Downloads/IMG_7974.PNG';

// === Desktop 테스트 ===
console.log('=== Desktop (1440x900) ===');
const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
desktopPage.on('console', msg => console.log(`[B] ${msg.text()}`));
desktopPage.on('pageerror', err => console.log(`[ERR] ${err.message}`));

await desktopPage.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await desktopPage.waitForTimeout(1000);

await desktopPage.locator('#cover-photo-input').setInputFiles(testPhoto);
console.log('Uploaded, waiting...');

for (let i = 0; i < 30; i++) {
  await desktopPage.waitForTimeout(2000);
  const hasChild = await desktopPage.evaluate(() => !!document.querySelector('.cover-child-img'));
  const hasLoading = await desktopPage.evaluate(() => !!document.querySelector('.cover-loading'));
  console.log(`${(i+1)*2}s: child=${hasChild} loading=${hasLoading}`);
  if (hasChild) break;
}

await desktopPage.screenshot({ path: '/tmp/quick-cover-desktop.png', fullPage: false });
console.log('Desktop screenshot saved');
await desktopPage.close();

// === Mobile 테스트 ===
console.log('\n=== Mobile (390x844) ===');
const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
mobilePage.on('console', msg => console.log(`[M] ${msg.text()}`));
mobilePage.on('pageerror', err => console.log(`[ERR] ${err.message}`));

await mobilePage.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobilePage.waitForTimeout(1000);

await mobilePage.locator('#cover-photo-input').setInputFiles(testPhoto);
console.log('Uploaded, waiting...');

for (let i = 0; i < 30; i++) {
  await mobilePage.waitForTimeout(2000);
  const hasChild = await mobilePage.evaluate(() => !!document.querySelector('.cover-child-img'));
  const hasLoading = await mobilePage.evaluate(() => !!document.querySelector('.cover-loading'));
  console.log(`${(i+1)*2}s: child=${hasChild} loading=${hasLoading}`);
  if (hasChild) break;
}

await mobilePage.screenshot({ path: '/tmp/quick-cover-mobile.png', fullPage: false });
console.log('Mobile screenshot saved');

await browser.close();
server.close();
