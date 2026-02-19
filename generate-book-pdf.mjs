import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===== 주문 데이터 (실제로는 JSON에서 로드) =====
const orderData = {
  first_name: '하은',
  photo: resolve(__dirname, 'test_images/IMG_5990.jpg'),
};

// ===== 설정 =====
const TEMPLATE = resolve(__dirname, 'book-template-demo.html');
const OUTPUT_PDF = '/tmp/monvie-book-sample.pdf';

// Booktory 본문 규격
const PAGE_WIDTH_MM = 203;   // 200mm trim + 3mm right bleed
const PAGE_HEIGHT_MM = 206;  // 200mm trim + 3mm top bleed + 3mm bottom bleed

// 300 DPI 환산: 1mm = 3.7795px at 96dpi → scale 300/96 = 3.125
const SCALE_FACTOR = 300 / 96;  // ≈ 3.125

async function generateBook() {
  console.log('📖 동화책 PDF 생성 시작...');
  console.log(`   이름: ${orderData.first_name}`);
  console.log(`   사진: ${orderData.photo}`);
  console.log(`   규격: ${PAGE_WIDTH_MM}×${PAGE_HEIGHT_MM}mm (bleed 포함)`);
  console.log(`   해상도: 300 DPI (scale ${SCALE_FACTOR.toFixed(2)}x)`);
  console.log('');

  const browser = await chromium.launch();
  const page = await browser.newPage({
    // 300 DPI: 고해상도 렌더링
    deviceScaleFactor: SCALE_FACTOR,
  });

  // 1. HTML 템플릿 로드
  const templateUrl = `file://${TEMPLATE}`;
  await page.goto(templateUrl, { waitUntil: 'load' });

  // 2. 데이터 주입 (템플릿 변수 치환 + 이미지 설정)
  const photoDataUrl = `file://${orderData.photo}`;
  await page.evaluate(({ name, photoUrl }) => {
    // 텍스트 치환: {{NAME}} → 실제 이름
    document.body.innerHTML = document.body.innerHTML
      .replace(/\{\{NAME\}\}/g, name);

    // 사진 주입
    document.getElementById('photo1').src = photoUrl;
    document.getElementById('photo2').src = photoUrl;
    document.getElementById('photo3').src = photoUrl;
  }, { name: orderData.first_name, photoUrl: photoDataUrl });

  // 이미지 로딩 대기
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => {
    const imgs = document.querySelectorAll('img');
    return Array.from(imgs).every(img => img.complete && img.naturalWidth > 0);
  }, { timeout: 10000 }).catch(() => {
    console.warn('⚠️ 일부 이미지 로딩 실패, 계속 진행...');
  });

  // 3. PDF 생성
  console.log('🖨️ PDF 렌더링 중...');
  await page.pdf({
    path: OUTPUT_PDF,
    width: `${PAGE_WIDTH_MM}mm`,
    height: `${PAGE_HEIGHT_MM}mm`,
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    // preferCSSPageSize: true,
  });

  console.log(`✅ PDF 생성 완료: ${OUTPUT_PDF}`);
  console.log('');

  // 4. 확인용 스크린샷 (각 페이지)
  // 페이지별 스크린샷을 위해 viewport 조정
  const pxW = Math.round(PAGE_WIDTH_MM * 3.7795);  // mm → px at 96dpi
  const pxH = Math.round(PAGE_HEIGHT_MM * 3.7795);
  await page.setViewportSize({ width: pxW, height: pxH * 4 }); // 4페이지

  await page.screenshot({
    path: '/tmp/monvie-book-preview.png',
    fullPage: true,
  });
  console.log('📸 미리보기 저장: /tmp/monvie-book-preview.png');

  await browser.close();
  console.log('');
  console.log('📋 PDF 사양:');
  console.log(`   페이지 크기: ${PAGE_WIDTH_MM}mm × ${PAGE_HEIGHT_MM}mm`);
  console.log(`   재단 크기(trim): 200mm × 200mm`);
  console.log(`   도련(bleed): top 3mm, right 3mm, bottom 3mm, left 0mm`);
  console.log('   해상도: 300 DPI');
  console.log('   총 페이지: 4');
}

generateBook().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
