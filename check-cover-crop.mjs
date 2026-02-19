import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8803;

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
  const filePath = path.join(__dirname, urlPath);
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
console.log(`Server on http://localhost:${PORT}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

// Listen to console logs to see smart crop result
page.on('console', msg => {
  const text = msg.text();
  if (text.includes('스마트') || text.includes('크롭') || text.includes('smart') || text.includes('배경')) {
    console.log(`[BROWSER] ${text}`);
  }
});

await page.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);

// Screenshot 1: Cover before upload
await page.screenshot({ path: '/tmp/cover-crop-1-before.png', fullPage: false });
console.log('Shot 1: before upload');

// Upload a test photo
const fileInput = page.locator('#cover-photo-input');
await fileInput.setInputFiles(path.join(__dirname, 'test_images/IMG_5602.jpg'));
console.log('File uploaded, waiting for smart crop + remove.bg...');

// Wait for loading to appear
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/cover-crop-2-loading.png', fullPage: false });
console.log('Shot 2: loading state');

// Wait for processing to complete (smart crop + remove.bg can take a while)
await page.waitForFunction(() => {
  const img = document.querySelector('.cover-photo-img');
  return img !== null;
}, { timeout: 60000 });
await page.waitForTimeout(500);

await page.screenshot({ path: '/tmp/cover-crop-3-result.png', fullPage: false });
console.log('Shot 3: result with bg removed');

await browser.close();
server.close();
console.log('Done — screenshots in /tmp/cover-crop-*.png');
