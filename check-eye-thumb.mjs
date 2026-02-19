import { chromium } from '@playwright/test';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Create test images
  for (const [path, color, label] of [
    ['/tmp/eye-test1.jpg', '#ff6b6b', 'A'],
    ['/tmp/eye-test2.jpg', '#4ecdc4', 'B'],
  ]) {
    const dataUrl = await page.evaluate(([c, l]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 400, 600);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 80px sans-serif';
      ctx.fillText(l, 160, 320);
      return canvas.toDataURL('image/jpeg', 0.9);
    }, [color, label]);
    fs.writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  // Click 사진 tab
  await page.click('.step-tab[data-step="2"]');
  await page.waitForTimeout(300);

  // Upload files
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#cover-upload-btn'),
  ]);
  await fc.setFiles(['/tmp/eye-test1.jpg', '/tmp/eye-test2.jpg']);

  // Wait for processing
  await page.waitForTimeout(8000);

  // Check state
  const info = await page.evaluate(() => {
    const thumbs = document.querySelectorAll('.candidate-thumb');
    return {
      candidateCount: coverCandidates.length,
      activeIndex: activeCandidateIndex,
      thumbCount: thumbs.length,
      thumbs: Array.from(thumbs).map((el, i) => {
        const img = el.querySelector('img');
        return {
          w: el.offsetWidth,
          h: el.offsetHeight,
          imgComplete: img?.complete,
          imgSrc: img?.src?.substring(0, 60),
          hasThumbFromResult: coverCandidates[i]?._thumbFromResult,
          hasCropData: !!coverCandidates[i]?.cropData,
          hasKeypoints: !!coverCandidates[i]?.cropData?.keypoints,
        };
      }),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  // Screenshots
  await page.screenshot({ path: '/tmp/eye-thumb-full.png' });
  const list = await page.$('.candidate-list');
  if (list) {
    const box = await list.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      await list.screenshot({ path: '/tmp/eye-thumb-list.png' });
      console.log('List screenshot saved');
    }
  }

  // Print relevant logs
  const relevant = logs.filter(l =>
    l.includes('크롭') || l.includes('배치') || l.includes('eye') ||
    l.includes('error') || l.includes('Error') || l.includes('실패')
  );
  if (relevant.length > 0) {
    console.log('\n=== RELEVANT LOGS ===');
    relevant.forEach(l => console.log(l));
  }

  await browser.close();
  console.log('Done!');
})();
