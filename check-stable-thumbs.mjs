import { chromium } from '@playwright/test';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Create test images
  for (const [path, color] of [['/tmp/tp1.jpg', '#ff6b6b'], ['/tmp/tp2.jpg', '#4ecdc4'], ['/tmp/tp3.jpg', '#a29bfe']]) {
    const dataUrl = await page.evaluate((c) => {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 400, 600);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 60px sans-serif';
      ctx.fillText('TEST', 100, 320);
      return canvas.toDataURL('image/jpeg', 0.9);
    }, color);
    fs.writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  // Click 사진 tab first (like real user)
  await page.click('.step-tab[data-step="2"]');
  await page.waitForTimeout(300);

  // Upload 3 files
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#cover-upload-btn'),
  ]);
  await fileChooser.setFiles(['/tmp/tp1.jpg', '/tmp/tp2.jpg', '/tmp/tp3.jpg']);
  await page.waitForTimeout(3000);

  // Check DOM state
  const info = await page.evaluate(() => {
    const thumbs = document.querySelectorAll('.candidate-thumb');
    return {
      candidateCount: coverCandidates.length,
      activeIndex: activeCandidateIndex,
      domThumbCount: thumbs.length,
      thumbSizes: Array.from(thumbs).map(el => ({
        w: el.offsetWidth, h: el.offsetHeight,
        imgW: el.querySelector('img')?.naturalWidth,
        imgH: el.querySelector('img')?.naturalHeight,
        imgComplete: el.querySelector('img')?.complete,
        src: el.querySelector('img')?.src.substring(0, 50),
      })),
      listVisible: !!document.querySelector('.candidate-list'),
      statusVisible: !!document.querySelector('.cover-status'),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  // Screenshots
  await page.screenshot({ path: '/tmp/stable-thumbs-full.png' });

  const list = await page.$('.candidate-list');
  if (list) {
    const box = await list.boundingBox();
    console.log('Candidate list box:', box);
    if (box && box.width > 0 && box.height > 0) {
      await list.screenshot({ path: '/tmp/stable-thumbs-list.png' });
      console.log('List screenshot OK');
    } else {
      console.log('WARNING: List has zero size!');
    }
  } else {
    console.log('WARNING: No candidate list found!');
  }

  await browser.close();
  console.log('Done!');
})();
