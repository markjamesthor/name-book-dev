import { chromium } from '@playwright/test';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // Collect console logs
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Create 2 test images (different sizes/colors)
  const img1Path = '/tmp/test-photo-1.jpg';
  const img2Path = '/tmp/test-photo-2.jpg';

  for (const [path, color] of [[img1Path, '#ff6b6b'], [img2Path, '#4ecdc4']]) {
    const dataUrl = await page.evaluate((c) => {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 400, 600);
      ctx.fillStyle = '#333';
      ctx.font = '40px sans-serif';
      ctx.fillText('TEST', 150, 300);
      return canvas.toDataURL('image/jpeg', 0.9);
    }, color);
    fs.writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  // Upload 2 files via file chooser
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.evaluate(() => document.getElementById('cover-photo-input').click()),
  ]);
  await fileChooser.setFiles([img1Path, img2Path]);
  await page.waitForTimeout(3000);

  // Debug: Check DOM state
  const debugInfo = await page.evaluate(() => {
    const info = {};
    info.candidateCount = coverCandidates.length;
    info.activeCandidateIndex = activeCandidateIndex;
    info.candidates = coverCandidates.map((c, i) => ({
      id: c.id,
      thumbURL: c.thumbURL ? c.thumbURL.substring(0, 80) + '...' : 'EMPTY',
      isProcessing: c.isProcessing,
      hasPhotoOptions: !!c.photoOptions,
      selectedModelKey: c.selectedModelKey,
    }));

    // Check actual DOM
    const thumbEls = document.querySelectorAll('.candidate-thumb');
    info.domThumbCount = thumbEls.length;
    info.domThumbs = Array.from(thumbEls).map(el => {
      const img = el.querySelector('img');
      return {
        src: img ? img.src.substring(0, 80) + '...' : 'NO_IMG',
        naturalWidth: img ? img.naturalWidth : 0,
        naturalHeight: img ? img.naturalHeight : 0,
        complete: img ? img.complete : false,
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
      };
    });

    // Check cover-controls innerHTML
    const controls = document.getElementById('cover-controls');
    info.controlsHTML = controls ? controls.innerHTML.substring(0, 500) : 'NO_CONTROLS';

    return info;
  });

  console.log('=== DEBUG INFO ===');
  console.log(JSON.stringify(debugInfo, null, 2));

  // Take screenshots
  await page.screenshot({ path: '/tmp/debug-thumbs-full.png' });

  const bottomPanel = await page.$('.bottom-panel');
  if (bottomPanel) {
    await bottomPanel.screenshot({ path: '/tmp/debug-thumbs-panel.png' });
  }

  const candidateList = await page.$('.candidate-list');
  if (candidateList) {
    await candidateList.screenshot({ path: '/tmp/debug-thumbs-list.png' });
    console.log('Candidate list found and captured');
  } else {
    console.log('WARNING: No .candidate-list found in DOM!');
  }

  // Print relevant console logs
  const relevantLogs = logs.filter(l => l.includes('크롭') || l.includes('실패') || l.includes('에러') || l.includes('error') || l.includes('Error'));
  if (relevantLogs.length > 0) {
    console.log('\n=== RELEVANT CONSOLE LOGS ===');
    relevantLogs.forEach(l => console.log(l));
  }

  await browser.close();
  console.log('\nDone!');
})();
