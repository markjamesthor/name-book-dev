import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===== 설정 =====
const DATA_FILE = resolve(__dirname, 'home-book-data.json');
const TEMPLATE  = resolve(__dirname, 'home-book.html');
const OUTPUT_PDF = '/tmp/monvie-home-book.pdf';

// Booktory 본문 규격 (가로형 body-horiz)
const PAGE_W = 256;  // mm (250 trim + 3 left bleed + 3 right bleed)
const PAGE_H = 206;  // mm (200 trim + 3 top + 3 bottom bleed)
const SCALE = 300 / 96;  // 300 DPI

// ===== 한국어 조사 처리 =====
function hasJong(str) {
  if (!str || str.length === 0) return false;
  const lastChar = str.charCodeAt(str.length - 1);
  if (lastChar < 0xAC00 || lastChar > 0xD7A3) return false;
  return (lastChar - 0xAC00) % 28 !== 0;
}

function applyJosa(text, name) {
  const jong = hasJong(name);
  return text
    .replace(/이\(가\)/g, jong ? '이' : '가')
    .replace(/은\(는\)/g, jong ? '은' : '는')
    .replace(/을\(를\)/g, jong ? '을' : '를')
    .replace(/아\(야\)/g, jong ? '아' : '야')
    .replace(/과\(와\)/g, jong ? '과' : '와')
    .replace(/이에요\(예요\)/g, jong ? '이에요' : '예요')
    .replace(/이야\(야\)/g, jong ? '이야' : '야');
}

function resolveText(text, order, family, toyPetNum) {
  if (!text) return '';
  let result = text;

  // 변수 치환
  result = result.replace(/\$\{firstName\}/g, order.first_name);
  result = result.replace(/\$\{toyPetCall\}/g, order[`toyPet${toyPetNum}Call`] || '');
  result = result.replace(/\$\{toyPetName\}/g, order[`toyPet${toyPetNum}Name`] || '');
  result = result.replace(/\$\{who\}/g, family.who || '');
  result = result.replace(/\$\{parents\}/g, family.parents || '');
  result = result.replace(/\$\{parent\}/g, family.parent || '');
  result = result.replace(/\$\{other\}/g, family.other || '');
  result = result.replace(/\$\{cabinet\}/g, family.cabinet || '');

  // 조사 처리 — firstName 기준
  // ${firstName}이는 → 하은이는 (종성 없음)
  // ${firstName}이가 → 하은이가
  result = applyJosa(result, order.first_name);

  return result;
}

async function generateHomeBook() {
  const data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  const { order, genderText, familyText, storyText, storyEndText } = data;
  const family = familyText[order.family_type];

  console.log('📖 HOME 동화책 PDF 생성');
  console.log(`   이름: ${order.first_name} (${order.gender})`);
  console.log(`   가족: ${order.family_type}`);
  console.log(`   문장: ${order.sentence_type}`);
  console.log(`   스토리: ${order.toyPet2Story}, ${order.toyPet3Story}, ${order.toyPet4Story}`);
  console.log(`   규격: ${PAGE_W}×${PAGE_H}mm (Booktory 본문)`);
  console.log('');

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: SCALE });

  await page.goto(`file://${TEMPLATE}`, { waitUntil: 'load' });

  // 사진 경로 (테스트용 — 실제로는 배경 제거된 PSD)
  const mainPhoto0 = `file://${resolve(__dirname, 'test_images/IMG_5990.jpg')}`;
  const mainPhoto1 = `file://${resolve(__dirname, 'test_images/IMG_6724.jpg')}`;
  const toyPetPhoto = `file://${resolve(__dirname, 'test_images/10.jpg')}`;

  // 스토리 텍스트 준비
  const stories = [
    { key: 'toyPet2', theme: order.toyPet2Story, call: order.toyPet2Call, name: order.toyPet2Name, num: 2 },
    { key: 'toyPet3', theme: order.toyPet3Story, call: order.toyPet3Call, name: order.toyPet3Name, num: 3 },
    { key: 'toyPet4', theme: order.toyPet4Story, call: order.toyPet4Call, name: order.toyPet4Name, num: 4 },
  ];

  // 스토리별 텍스트 처리
  const processedStories = stories.map(s => {
    const themeData = storyText[s.theme]?.[order.sentence_type] || [];
    return themeData.map(pageData => ({
      text: resolveText(pageData.text, order, family, s.num),
      toyPetSaid: resolveText(pageData.toyPetSaid, order, family, s.num),
      textTop: pageData.textTop,
      color: pageData.color,
      speechBalloon: pageData.speechBalloon,
    }));
  });

  // storyEndText 처리
  const endTexts = stories.map(s => {
    const raw = storyEndText[order.sentence_type]?.[s.key] || '';
    return resolveText(raw, order, family, s.num);
  });

  // 데이터 주입
  await page.evaluate(({
    order, genderText, family, mainPhoto0, mainPhoto1, toyPetPhoto,
    processedStories, endTexts,
  }) => {
    const $ = id => document.getElementById(id);

    // ── 커버 ──
    $('cover-title').textContent = `${order.first_name}의 우리 집 보물찾기`;
    $('cover-photo').src = mainPhoto0;
    $('cover-author').textContent = `글 ${order.author}`;

    // ── 표제지 ──
    $('title-name').textContent = `${genderText[order.gender]} ${order.first_name}`;
    $('title-photo').src = mainPhoto0;

    // ── 성 페이지 ──
    const castleText = `옛날 옛날, 아주 먼 곳에\n${genderText[order.gender]} ${order.first_name}이가 살았어요.\n\n${family.who}의 사랑을 듬뿍 받으며\n행복하게 지내고 있었지요.\n\n그런데 어느 날,\n${family.question}`;
    $('castle-text').textContent = castleText;
    $('castle-photo').src = mainPhoto0;

    // ── 뭉치(toyPet1) ──
    $('toypet1-text').textContent = `${order.first_name}이의 가장 친한 친구,\n${order.toyPet1Name}을 소개할게요!`;
    $('toypet1-photo').src = toyPetPhoto;

    // ── 바닷속 ──
    $('ocean-photo').src = mainPhoto1;
    $('ocean-name').textContent = order.first_name;

    // ── 기차 ──
    $('train-photo').src = mainPhoto1;
    $('train-name').textContent = order.first_name;

    // ── 스토리 1 (ToyPet2) ──
    for (let i = 0; i < 2 && i < processedStories[0].length; i++) {
      const p = processedStories[0][i];
      const textEl = $(`story1-${i}-text`);
      const balloonEl = $(`story1-${i}-balloon`);
      if (p.text) {
        textEl.textContent = p.text;
        textEl.style.top = `${Math.round(p.textTop * 206)}mm`;
      }
      textEl.className = `story-text-frame color-${p.color}`;
      if (p.speechBalloon && p.toyPetSaid) {
        balloonEl.className = 'speech-balloon';
        balloonEl.style.display = 'block';
        balloonEl.style.left = `${p.speechBalloon.left * 256}mm`;
        balloonEl.style.top = `${p.speechBalloon.top * 206}mm`;
        balloonEl.textContent = p.toyPetSaid;
      }
    }
    $('story1-photo').src = mainPhoto0;

    // ── 길 걷는 아이 1 ──
    $('walk1-photo').src = mainPhoto1;
    $('walk1-text').textContent = `${order.first_name}이는 보물을 찾아 걸어갔어요.\n어디에 보물이 있을까?`;

    // ── 스토리 2 (ToyPet3) ──
    for (let i = 0; i < 2 && i < processedStories[1].length; i++) {
      const p = processedStories[1][i];
      const textEl = $(`story2-${i}-text`);
      const balloonEl = $(`story2-${i}-balloon`);
      if (p.text) {
        textEl.textContent = p.text;
        textEl.style.top = `${Math.round(p.textTop * 206)}mm`;
      }
      textEl.className = `story-text-frame color-${p.color}`;
      if (p.speechBalloon && p.toyPetSaid) {
        balloonEl.className = 'speech-balloon';
        balloonEl.style.display = 'block';
        balloonEl.style.left = `${p.speechBalloon.left * 256}mm`;
        balloonEl.style.top = `${p.speechBalloon.top * 206}mm`;
        balloonEl.textContent = p.toyPetSaid;
      }
    }
    $('story2-photo').src = mainPhoto0;

    // ── 길 걷는 아이 2 ──
    $('walk2-photo').src = mainPhoto1;
    $('walk2-text').textContent = `보물이 어디있지?\n${order.first_name}이는 계속 걸어갔어요.`;

    // ── 스토리 3 (ToyPet4) ──
    for (let i = 0; i < 2 && i < processedStories[2].length; i++) {
      const p = processedStories[2][i];
      const textEl = $(`story3-${i}-text`);
      const balloonEl = $(`story3-${i}-balloon`);
      if (p.text) {
        textEl.textContent = p.text;
        textEl.style.top = `${Math.round(p.textTop * 206)}mm`;
      }
      textEl.className = `story-text-frame color-${p.color}`;
      if (p.speechBalloon && p.toyPetSaid) {
        balloonEl.className = 'speech-balloon';
        balloonEl.style.display = 'block';
        balloonEl.style.left = `${p.speechBalloon.left * 256}mm`;
        balloonEl.style.top = `${p.speechBalloon.top * 206}mm`;
        balloonEl.textContent = p.toyPetSaid;
      }
    }
    $('story3-photo').src = mainPhoto0;

    // ── 보물 힌트 (storyEndText) ──
    $('hint2-text').textContent = endTexts[0];
    $('hint3-text').textContent = endTexts[1];
    $('hint4-text').textContent = endTexts[2];

    // ── 보물 페이지 (거울) ──
    $('treasure-photo').src = mainPhoto0;
    $('treasure-caption').textContent = `바로 ${order.first_name}이야!`;

    // ── 엔딩 ──
    $('ending-title').textContent = `${order.first_name}이의 소중한 친구들`;
    $('ending-pet1').src = toyPetPhoto;
    $('ending-pet2').src = toyPetPhoto;
    $('ending-pet3').src = toyPetPhoto;
    $('ending-pet4').src = toyPetPhoto;
    $('ending-pet1-name').textContent = order.toyPet1Name;
    $('ending-pet2-name').textContent = order.toyPet2Name;
    $('ending-pet3-name').textContent = order.toyPet3Name;
    $('ending-pet4-name').textContent = order.toyPet4Name;

    // ── 편지 ──
    $('letter-text').textContent = order.letter;
    $('letter-date').textContent = order.print_date;
    $('letter-bookid').textContent = order.book_id;

  }, {
    order, genderText, family, mainPhoto0, mainPhoto1, toyPetPhoto,
    processedStories, endTexts,
  });

  // 이미지 로딩 대기
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const imgs = document.querySelectorAll('img');
    return Array.from(imgs).every(img => !img.src || img.complete);
  }, { timeout: 15000 }).catch(() => console.warn('⚠️ 일부 이미지 로딩 실패'));

  // PDF 생성
  console.log('🖨️ PDF 렌더링 중...');
  await page.pdf({
    path: OUTPUT_PDF,
    width: `${PAGE_W}mm`,
    height: `${PAGE_H}mm`,
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  console.log(`✅ PDF 생성 완료: ${OUTPUT_PDF}`);

  // 미리보기 스크린샷
  const pxW = Math.round(PAGE_W * 3.7795);
  const pxH = Math.round(PAGE_H * 3.7795);
  const pageCount = await page.evaluate(() => document.querySelectorAll('.page').length);
  await page.setViewportSize({ width: pxW, height: pxH * pageCount });
  await page.screenshot({ path: '/tmp/monvie-home-preview.png', fullPage: true });
  console.log(`📸 미리보기: /tmp/monvie-home-preview.png (${pageCount}페이지)`);

  await browser.close();

  console.log('');
  console.log('📋 HOME 책 사양:');
  console.log(`   총 ${pageCount}페이지 (SHORT 기준)`);
  console.log(`   규격: ${PAGE_W}×${PAGE_H}mm (bleed 포함)`);
  console.log(`   Trim: 250×200mm (가로형)`);
  console.log('   300 DPI');
  console.log(`   스토리: ${order.toyPet2Story}, ${order.toyPet3Story}, ${order.toyPet4Story}`);
}

generateHomeBook().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
