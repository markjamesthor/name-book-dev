import { webkit, chromium } from '@playwright/test';

(async () => {
  for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
    const browser = await engine.launch();
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
    });
    const page = await ctx.newPage();

    await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.fill('#input-firstName', '도현');
    await page.waitForTimeout(300);
    await page.click('.step-tab[data-step="1"]');
    await page.waitForTimeout(300);

    const totalPages = await page.evaluate(() => getPages().length);
    console.log(`\n=== ${name} (${totalPages} pages) ===`);

    let bugs = 0;
    for (let idx = 0; idx < totalPages; idx++) {
      await page.evaluate((i) => jumpToPage(i), idx);
      await page.waitForTimeout(600);

      const info = await page.evaluate(() => {
        const slides = Array.from(document.querySelectorAll('.carousel-slide'));
        const visible = slides.find(s => {
          const r = s.getBoundingClientRect();
          return r.left >= 0 && r.left < 400;
        });
        if (!visible) return null;

        const bgImg = visible.querySelector('.page-bg-img');
        const cs = bgImg ? getComputedStyle(bgImg) : null;
        const isCoverPage = visible.classList.contains('slide-cover');
        const wrapRect = visible.querySelector('.slide-img-wrap')?.getBoundingClientRect();
        const imgRect = bgImg?.getBoundingClientRect();

        return {
          isCoverPage,
          objectFit: cs?.objectFit,
          fillsWidth: wrapRect && imgRect ? Math.abs(imgRect.width - wrapRect.width) < 2 : null,
          gapLeft: wrapRect && imgRect ? (imgRect.left - wrapRect.left).toFixed(1) : null,
          gapRight: wrapRect && imgRect ? (wrapRect.right - imgRect.right).toFixed(1) : null,
        };
      });

      const isCover = idx === 0;
      const expectedFit = isCover ? 'contain' : 'cover';
      const fitOk = info?.objectFit === expectedFit;
      const fillOk = info?.fillsWidth !== false;
      const flag = (!fitOk || !fillOk) ? ' ← PROBLEM' : '';
      if (flag) bugs++;

      console.log(`  p${idx}: fit=${info?.objectFit}(want ${expectedFit}) fill=${info?.fillsWidth} cover-class=${info?.isCoverPage}${flag}`);

      if (name === 'webkit') {
        await page.screenshot({ path: `/tmp/wk-all-${idx}.png` });
      }
    }
    console.log(`  → ${bugs} problems found`);
    await browser.close();
  }
  console.log('\nDone!');
})();
