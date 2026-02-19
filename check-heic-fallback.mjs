import { chromium } from '@playwright/test';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', msg => {
    if (msg.type() === 'warn' || msg.type() === 'error') console.log(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Create a fake HEIC file (Chrome can't decode it → fallback)
  fs.writeFileSync('/tmp/fake.heic', Buffer.from('NOT_A_REAL_HEIC_FILE'));
  // Create a normal JPEG
  const jpegData = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 400;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4ecdc4'; ctx.fillRect(0, 0, 300, 400);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('OK', 120, 210);
    return c.toDataURL('image/jpeg', 0.9);
  });
  fs.writeFileSync('/tmp/test-ok.jpg', Buffer.from(jpegData.split(',')[1], 'base64'));

  // Click 사진 tab
  await page.click('.step-tab[data-step="2"]');
  await page.waitForTimeout(300);

  // Upload HEIC + JPEG
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#cover-upload-btn'),
  ]);
  await fc.setFiles(['/tmp/fake.heic', '/tmp/test-ok.jpg']);
  await page.waitForTimeout(3000);

  // Check state
  const info = await page.evaluate(() => {
    const thumbs = document.querySelectorAll('.candidate-thumb');
    return {
      count: thumbs.length,
      thumbs: Array.from(thumbs).map(el => ({
        w: el.offsetWidth, h: el.offsetHeight,
        imgSrc: el.querySelector('img')?.src?.substring(0, 60) || 'none',
        imgComplete: el.querySelector('img')?.complete,
      })),
      urls: coverCandidates.map(c => c.thumbURL.substring(0, 60)),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await page.screenshot({ path: '/tmp/heic-fallback-full.png' });
  const list = await page.$('.candidate-list');
  if (list) {
    const box = await list.boundingBox();
    if (box && box.width > 0) await list.screenshot({ path: '/tmp/heic-fallback-list.png' });
  }

  await browser.close();
  console.log('Done!');
})();
