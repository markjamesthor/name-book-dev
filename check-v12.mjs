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

// Shot 1: Page 0 (프롤로그) - A version
await mobile.screenshot({ path: '/tmp/v12-m-p0-A.png' });
console.log('Shot 1: mobile page 0 A version (prologue)');

// Shot 2: Page 1 (노미네 왕국) - A version
await mobile.click('#m-btn-next');
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: '/tmp/v12-m-p1-A.png' });
console.log('Shot 2: mobile page 1 A version');

// Navigate to page 10 (이름의 탄생) to see {nameLetters}
for (let i = 0; i < 9; i++) {
  await mobile.click('#m-btn-next');
  await mobile.waitForTimeout(500);
}
await mobile.screenshot({ path: '/tmp/v12-m-p10-A.png' });
console.log('Shot 3: mobile page 10 A version (name creation)');

// Navigate to page 14 (우리의 비밀)
for (let i = 0; i < 4; i++) {
  await mobile.click('#m-btn-next');
  await mobile.waitForTimeout(500);
}
await mobile.screenshot({ path: '/tmp/v12-m-p14-A.png' });
console.log('Shot 4: mobile page 14 A version (our secret)');

// Navigate to page 15 (에필로그)
await mobile.click('#m-btn-next');
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: '/tmp/v12-m-p15-A.png' });
console.log('Shot 5: mobile page 15 A version (epilogue)');

// Switch to B version - use mobile version bar
await mobile.click('.mobile-version-bar .version-btn[data-version="B"]');
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: '/tmp/v12-m-p15-B.png' });
console.log('Shot 6: mobile page 15 B version (same page after switch)');

// Go to page 0 B version
for (let i = 0; i < 15; i++) {
  await mobile.click('#m-btn-prev');
  await mobile.waitForTimeout(400);
}
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: '/tmp/v12-m-p0-B.png' });
console.log('Shot 7: mobile page 0 B version (prologue)');

// Go to page 5 B version (고대의 마법 - ancient_stair)
for (let i = 0; i < 5; i++) {
  await mobile.click('#m-btn-next');
  await mobile.waitForTimeout(500);
}
await mobile.screenshot({ path: '/tmp/v12-m-p5-B.png' });
console.log('Shot 8: mobile page 5 B version (ancient magic)');

// Desktop check
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await desktop.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await desktop.waitForTimeout(800);

await desktop.screenshot({ path: '/tmp/v12-d-p0-A.png' });
console.log('Shot 9: desktop page 0 A version');

// Switch to B, navigate to page 5
await desktop.click('.version-btn[data-version="B"]');
await desktop.waitForTimeout(500);
for (let i = 0; i < 5; i++) {
  await desktop.click('#btn-next');
  await desktop.waitForTimeout(500);
}
await desktop.screenshot({ path: '/tmp/v12-d-p5-B.png' });
console.log('Shot 10: desktop page 5 B version');

await browser.close();
server.close();
console.log('Done - all 10 shots taken');
