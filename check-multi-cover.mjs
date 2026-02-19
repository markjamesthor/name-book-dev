import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto(`file://${path.resolve(__dirname, 'book-preview.html')}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Step 1: Initial state - click 사진 tab
  await page.click('.step-tab[data-step="2"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/multi-cover-01-initial.png' });
  console.log('Screenshot 1: Initial photo tab (no candidates)');

  // Inject minimal config so renderCarousel works
  await page.evaluate(() => {
    config = {
      defaults: { firstName: '도현', parentNames: '엄마 아빠' },
      versions: { A: { pages: [{ scene: '1', title: 'p1', text: '테스트', illustration: 'golden_star', textPosition: 'top', textColor: 'white' }] }, B: { pages: [] } },
      illustrations: { golden_star: 'NAME/cover_bg.jpg' }
    };
    updateVariables();
    renderCarousel();
    renderThumbnails();
  });
  await page.waitForTimeout(300);

  // Step 2: Simulate adding candidates by injecting into the state
  await page.evaluate(() => {
    // Create mock thumb data URL (solid color)
    const makeThumb = (color) => {
      const canvas = document.createElement('canvas');
      canvas.width = 104; canvas.height = 104;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 104, 104);
      return canvas.toDataURL('image/jpeg', 0.8);
    };

    // Add 3 mock candidates
    coverCandidates = [
      {
        id: 0, thumbURL: makeThumb('#ff6b6b'), originalFile: null,
        croppedFile: null, cropData: null, photoOptions: null,
        selectedModelKey: null, photoURL: null, manualOffset: null,
        isProcessing: true, loadingText: '배경을 지우는 중...'
      },
      {
        id: 1, thumbURL: makeThumb('#4ecdc4'), originalFile: null,
        croppedFile: null, cropData: null, photoOptions: { portrait: { url: '' } },
        selectedModelKey: 'portrait', photoURL: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=',
        manualOffset: null, isProcessing: false, loadingText: ''
      },
      {
        id: 2, thumbURL: makeThumb('#45b7d1'), originalFile: null,
        croppedFile: null, cropData: null, photoOptions: null,
        selectedModelKey: null, photoURL: null, manualOffset: null,
        isProcessing: true, loadingText: '인물을 감지하는 중...'
      }
    ];
    activeCandidateIndex = 0;
    nextCandidateId = 3;

    // Sync first candidate to globals
    syncCandidateToGlobals(coverCandidates[0]);
    renderCoverControls();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/multi-cover-02-candidates-processing.png' });
  console.log('Screenshot 2: Candidates list with processing state');

  // Step 3: Switch to candidate 1 (completed)
  await page.evaluate(() => {
    switchCandidate(1);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/multi-cover-03-candidate-complete.png' });
  console.log('Screenshot 3: Switched to completed candidate');

  // Step 4: Close-up of candidate list
  const candidateList = await page.$('.candidate-list');
  if (candidateList) {
    await candidateList.screenshot({ path: '/tmp/multi-cover-04-list-closeup.png' });
    console.log('Screenshot 4: Candidate list close-up');
  }

  await browser.close();
  console.log('Done!');
})();
