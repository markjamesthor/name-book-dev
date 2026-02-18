/**
 * 노미네 왕국 — Book Preview Engine
 * Config-Driven 동화책 미리보기 (Carousel)
 */

// ========== Korean Language Helpers ==========

function hasBatchim(char) {
  const code = char.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return false;
  return (code - 0xAC00) % 28 !== 0;
}

function nameHasBatchim(name) {
  if (!name || name.length === 0) return false;
  return hasBatchim(name[name.length - 1]);
}

function casualName(firstName) {
  return nameHasBatchim(firstName) ? firstName + '이' : firstName;
}

function decomposeKorean(str) {
  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const letters = [];
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      letters.push(CHO[Math.floor(offset / (21 * 28))], JUNG[Math.floor((offset % (21 * 28)) / 28)]);
      if (offset % 28 !== 0) letters.push(JONG[offset % 28]);
    } else {
      letters.push(ch);
    }
  }
  return letters.join(', ');
}

// ========== Variable Substitution ==========

function substituteVars(text, vars) {
  if (!text) return '';
  return text
    .replace(/\{name\}/g, vars.name)
    .replace(/\{firstName\}/g, vars.firstName)
    .replace(/\{parentNames\}/g, vars.parentNames)
    .replace(/\{nameLetters\}/g, vars.nameLetters);
}

// ========== App State ==========
let config = null;
let currentVersion = 'A';
let currentPageIndex = 0;
let variables = {};
let isAnimating = false;
let coverPhotoURL = null;   // 배경 제거된 사진 blob URL
let isRemovingBg = false;   // 로딩 상태
let coverLoadingText = '';  // 단계별 로딩 텍스트
let coverCropData = null;   // { keypoints, refY, refHeight } — 키포인트 기반 배치용
let coverPhotoOptions = null; // { portrait: {...}, ben2: {...}, 'hr-matting': {...} }
let selectedModelKey = null;  // 현재 선택된 모델 키
let coverManualOffset = null; // { dx: %, dy: % } — 수동 위치 조정값
let isEditingCoverPos = false; // 위치 편집 모드

const BG_REMOVE_MODELS = [
  { key: 'portrait', label: '1' },
  { key: 'ben2', label: '2' },
  { key: 'hr-matting', label: '3' },
];

// ========== DOM ==========
const els = {};

function cacheDom() {
  els.firstNameInput = document.getElementById('input-firstName');
  els.parentNamesInput = document.getElementById('input-parentNames');
  els.mFirstNameInput = document.getElementById('m-input-firstName');
  els.mParentNamesInput = document.getElementById('m-input-parentNames');
  els.versionBtns = document.querySelectorAll('.version-btn');
  els.pageViewer = document.getElementById('page-viewer');
  els.pageTitle = document.getElementById('page-title');
  els.pageCounter = document.getElementById('page-counter');
  els.pageCounterBottom = document.getElementById('page-counter-bottom');
  els.mPageTitle = document.getElementById('m-page-title');
  els.mPageCounter = document.getElementById('m-page-counter');
  els.prevBtn = document.getElementById('btn-prev');
  els.nextBtn = document.getElementById('btn-next');
  els.mPrevBtn = document.getElementById('m-btn-prev');
  els.mNextBtn = document.getElementById('m-btn-next');
  els.thumbnailStrip = document.getElementById('thumbnail-strip');
  els.settingsBtn = document.getElementById('btn-settings');
  els.settingsOverlay = document.getElementById('settings-overlay');
  els.settingsBackdrop = document.getElementById('settings-backdrop');
}

// ========== Config Loading ==========

async function loadConfig() {
  try {
    const resp = await fetch('configs/name.config.json?t=' + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    config = await resp.json();
  } catch (e) {
    if (window.__BOOK_CONFIG) {
      config = window.__BOOK_CONFIG;
    } else {
      console.error('Config load failed:', e);
      els.pageViewer.innerHTML = '<div style="padding:40px;color:#f66;text-align:center;">Config 로드 실패.<br><code>python3 -m http.server 8765</code></div>';
      return;
    }
  }

  const fn = config.defaults.firstName;
  const pn = config.defaults.parentNames;
  els.firstNameInput.value = fn;
  els.parentNamesInput.value = pn;
  els.mFirstNameInput.value = fn;
  els.mParentNamesInput.value = pn;

  updateVariables();
  renderCarousel();
  renderThumbnails();
}

// ========== Variable Update ==========

function updateVariables() {
  const firstName = els.firstNameInput.value.trim() || config.defaults.firstName;
  const parentNames = els.parentNamesInput.value.trim() || config.defaults.parentNames;
  variables = {
    firstName,
    name: casualName(firstName),
    parentNames,
    nameLetters: decomposeKorean(firstName)
  };
}

function syncInputs(source) {
  if (source === 'desktop') {
    els.mFirstNameInput.value = els.firstNameInput.value;
    els.mParentNamesInput.value = els.parentNamesInput.value;
  } else {
    els.firstNameInput.value = els.mFirstNameInput.value;
    els.parentNamesInput.value = els.mParentNamesInput.value;
  }
}

// ========== Carousel ==========

function getPages() {
  const coverPage = {
    scene: '커버',
    title: '커버',
    isCover: true,
    illustration: 'golden_star'
  };
  return [coverPage, ...config.versions[currentVersion].pages];
}

// 서버가 alpha bbox로 크롭한 이미지를 원본(스마트크롭) 크기로 패딩 → 모든 모델 동일 크기
function padImageToRef(blob, cropX, cropY, refW, refH) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = refW;
      canvas.height = refH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, cropX, cropY);
      canvas.toBlob(b => {
        URL.revokeObjectURL(img.src);
        resolve(URL.createObjectURL(b));
      }, 'image/webp', 0.9);
    };
    img.src = URL.createObjectURL(blob);
  });
}

function computeChildPositionWith(srvCropY, srvCropH) {
  if (!coverCropData || !coverCropData.keypoints) return null;

  const kps = coverCropData.keypoints;
  const refY = coverCropData.refY;
  const refH = coverCropData.refHeight;
  const cropY = srvCropY || 0;
  const cropH = srvCropH || refH;

  const refX = coverCropData.refX || 0;
  const refW = coverCropData.refWidth || 1;

  const findKpY = (name) => {
    const kp = kps.find(k => k.name === name && k.score > 0.3);
    if (!kp) return null;
    const posInSmartCrop = kp.y - refY;
    return (posInSmartCrop - cropY) / cropH;
  };

  const findKpX = (name) => {
    const kp = kps.find(k => k.name === name && k.score > 0.3);
    if (!kp) return null;
    return (kp.x - refX) / refW;
  };

  const eyeL = findKpY('left_eye');
  const eyeR = findKpY('right_eye');
  if (eyeL === null && eyeR === null) return null;
  const eyeY = eyeL !== null && eyeR !== null ? (eyeL + eyeR) / 2 : (eyeL || eyeR);
  const ey = Math.max(0.05, Math.min(0.95, eyeY));

  // 눈 X 중간점 (이미지 내 비율, 0=왼쪽, 1=오른쪽)
  const eyeLx = findKpX('left_eye');
  const eyeRx = findKpX('right_eye');
  const eyeX = eyeLx !== null && eyeRx !== null ? (eyeLx + eyeRx) / 2
             : (eyeLx || eyeRx || 0.5);

  const hipL = findKpY('left_hip');
  const hipR = findKpY('right_hip');
  const kneeL = findKpY('left_knee');
  const kneeR = findKpY('right_knee');
  let hipY = null;
  if (hipL !== null || hipR !== null) {
    hipY = hipL !== null && hipR !== null ? (hipL + hipR) / 2 : (hipL || hipR);
  } else if (kneeL !== null || kneeR !== null) {
    hipY = kneeL !== null && kneeR !== null ? (kneeL + kneeR) / 2 : (kneeL || kneeR);
  }
  if (hipY === null || hipY - ey < 0.05) return null;

  const h = 50 / (hipY - ey);
  const t = 50 - ey * h;

  // 눈 X 중간점이 화면 중앙에 오도록 left 오프셋 계산
  // left = 50% - (eyeX * width%) → translateX(-50%) 대신 눈 기준으로 정렬
  const leftOffset = 50 - eyeX * 100; // eyeX=0.5이면 offset=0 (기본 중앙)

  console.log(`아이 배치: eye=${ey.toFixed(3)} hip=${hipY.toFixed(3)} eyeX=${eyeX.toFixed(3)} → height=${h.toFixed(1)}% top=${t.toFixed(1)}% leftOff=${leftOffset.toFixed(1)}%`);
  return { height: h, top: t, leftOffset };
}

function computeChildPosition() {
  // 이미지가 padImageToRef로 원본 크기에 패딩되므로 cropY=0, cropH=refHeight
  return computeChildPositionWith(0, coverCropData?.refHeight);
}

function buildCoverContent() {
  const bgPath = config.illustrations['golden_star'];
  const coverTitle = `내 이름은 왜 ${variables.firstName}이야?`;
  const titleStyle = getCoverTitleStyle();
  const titleHtml = `<div class="cover-top-title"${titleStyle ? ` style="${titleStyle}"` : ''}><div class="cover-top-title-text">${coverTitle}</div></div>`;

  // 배경: 다른 페이지와 동일한 구조 (page-bg-blur + page-bg-img)
  let imgContent = `<div class="page-bg-blur" style="background-image:url('${bgPath}')"></div>
    <img class="page-bg-img" src="${bgPath}" alt="커버" />`;

  // 토글: coverPhotoOptions가 존재하면 항상 표시 (로딩 중인 항목은 로딩 표시)
  let toggleHtml = '';
  if (coverPhotoOptions) {
    const opts = BG_REMOVE_MODELS.map(m => {
      const loaded = !!coverPhotoOptions[m.key];
      const active = selectedModelKey === m.key;
      let cls = 'model-toggle-option';
      if (active) cls += ' active';
      if (!loaded) cls += ' model-toggle-loading';
      return `<div class="${cls}" data-model="${m.key}">${m.label}</div>`;
    }).join('');
    toggleHtml = `<div class="model-toggle-wrap">
      <div class="model-toggle-hint">확대해서 배경이 가장 잘 지워진 사진을 골라주세요.</div>
      <div class="model-toggle">${opts}</div>
    </div>`;
  }

  // 선택된 모델의 결과가 있으면 아이 사진 표시
  const selectedOpt = selectedModelKey && coverPhotoOptions && coverPhotoOptions[selectedModelKey];
  if (selectedOpt && coverPhotoURL) {
    const pos = computeChildPosition();
    let childStyle;
    if (pos) {
      const mdx = coverManualOffset ? coverManualOffset.dx : 0;
      const mdy = coverManualOffset ? coverManualOffset.dy : 0;
      const tx = (pos.leftOffset - 50) + mdx;
      childStyle = `height:${pos.height.toFixed(1)}%;top:${(pos.top + mdy).toFixed(1)}%;left:50%;transform:translateX(${tx.toFixed(1)}%)`;
    } else {
      childStyle = 'height:80%;bottom:0;left:50%;transform:translateX(-50%)';
    }
    const wrapStyle = getCoverLayoutStyle();
    imgContent += `<div class="cover-child-wrap"${wrapStyle ? ` style="${wrapStyle}"` : ''}><img class="cover-child-img" src="${coverPhotoURL}" style="${childStyle}" /></div>`;
    const actionHtml = `<div class="cover-action-menu">
      <button class="cover-action-btn" data-action="move">위치 변경</button>
      <button class="cover-action-btn" data-action="change">사진 변경</button>
    </div>`;

    return `
      <div class="slide-img-wrap">${imgContent}${titleHtml}</div>${toggleHtml}${actionHtml}`;
  }

  // 선택된 모델이 로딩 중이거나 배경 제거 진행 중 → 스피너
  if (coverPhotoOptions || isRemovingBg) {
    return `
      <div class="slide-img-wrap">${imgContent}${titleHtml}</div>
      <div class="cover-layout"><div class="cover-loading">
        <div class="cover-spinner"></div>
        <div class="cover-loading-text">${coverLoadingText || '처리 중...'}</div>
      </div></div>${toggleHtml}`;
  }

  // 업로드 전
  return `
    <div class="slide-img-wrap">${imgContent}${titleHtml}</div>
    <div class="cover-layout"><div class="cover-photo-zone" id="cover-upload-zone">
      <div class="upload-icon">📷</div>
      <div class="upload-text">사진을 선택하세요</div>
    </div></div>`;
}

function buildSlideContent(pageIndex) {
  const pages = getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) return '';

  const page = pages[pageIndex];

  // Cover page — special rendering
  if (page.isCover) return buildCoverContent();

  let imgContent = '';
  if (page.illustration && config.illustrations[page.illustration]) {
    const imgPath = config.illustrations[page.illustration];
    imgContent = `<div class="page-bg-blur" style="background-image:url('${imgPath}')"></div>
      <img class="page-bg-img" src="${imgPath}" alt="${page.title}" />`;
  } else if (page.bgGradient) {
    imgContent = `<div class="page-bg-gradient" style="background:${page.bgGradient}"></div>`;
  }

  const text = substituteVars(page.text, variables);
  const textColor = page.textColor || 'white';
  const posClass = `text-pos-${page.textPosition || 'center'}`;

  return `
    <div class="slide-img-wrap">${imgContent}</div>
    <div class="page-text-overlay ${posClass}" style="color:${textColor}">
      <div class="page-story-text">${text.replace(/\n/g, '<br>')}</div>
    </div>`;
}

let coverBgNatSize = null; // 배경 이미지 원본 크기 캐시
let cachedCoverLayout = null; // { imgX, imgY, imgW, imgH } — 마지막 계산된 커버 레이아웃

function getCoverLayoutStyle() {
  // 캐시된 레이아웃으로 인라인 스타일 문자열 반환
  if (!cachedCoverLayout) return '';
  const { imgX, imgY, imgW, imgH } = cachedCoverLayout;
  return `left:${imgX}px;top:${imgY}px;width:${imgW}px;height:${imgH}px`;
}

function getCoverTitleStyle() {
  if (!cachedCoverLayout) return '';
  const { imgX, imgY, imgW } = cachedCoverLayout;
  return `top:${imgY}px;left:${imgX}px;width:${imgW}px`;
}

function positionCoverChild() {
  const currentSlide = document.querySelector('.carousel-slide:nth-child(2)');
  if (!currentSlide) return;
  const wrap = currentSlide.querySelector('.slide-img-wrap');
  if (!wrap) return;
  const bgImg = wrap.querySelector('.page-bg-img');
  if (!bgImg) return;

  if (!coverBgNatSize) {
    if (bgImg.naturalWidth) {
      coverBgNatSize = { w: bgImg.naturalWidth, h: bgImg.naturalHeight };
    } else {
      bgImg.addEventListener('load', () => {
        coverBgNatSize = { w: bgImg.naturalWidth, h: bgImg.naturalHeight };
        positionCoverChild();
      }, { once: true });
      return;
    }
  }

  const contW = wrap.clientWidth;
  const contH = wrap.clientHeight;
  const natW = coverBgNatSize.w;
  const natH = coverBgNatSize.h;
  const fit = getComputedStyle(bgImg).objectFit;

  let imgW, imgH, imgX, imgY;
  if (fit === 'contain') {
    const scale = Math.min(contW / natW, contH / natH);
    imgW = natW * scale;
    imgH = natH * scale;
    imgX = (contW - imgW) / 2;
    imgY = (contH - imgH) / 2;
  } else {
    imgW = contW;
    imgH = contH;
    imgX = 0;
    imgY = 0;
  }

  // 레이아웃 캐시 업데이트
  cachedCoverLayout = { imgX, imgY, imgW, imgH };

  // 아이 사진 위치
  const childWrap = wrap.querySelector('.cover-child-wrap');
  if (childWrap) {
    childWrap.style.left = `${imgX}px`;
    childWrap.style.top = `${imgY}px`;
    childWrap.style.width = `${imgW}px`;
    childWrap.style.height = `${imgH}px`;
  }

  // 타이틀 위치
  const titleEl = wrap.querySelector('.cover-top-title');
  if (titleEl) {
    titleEl.style.top = `${imgY}px`;
    titleEl.style.left = `${imgX}px`;
    titleEl.style.width = `${imgW}px`;
  }
}

function renderCarousel() {
  const pages = getPages();
  if (currentPageIndex >= pages.length) currentPageIndex = pages.length - 1;
  if (currentPageIndex < 0) currentPageIndex = 0;

  const viewer = els.pageViewer;
  viewer.innerHTML = '<div class="carousel-track" id="carousel-track"></div>';

  const track = document.getElementById('carousel-track');
  const vw = viewer.clientWidth;
  // Create 3 slides: [prev, current, next]
  for (let i = -1; i <= 1; i++) {
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';
    slide.style.width = `${vw}px`;
    const pageIdx = currentPageIndex + i;
    slide.dataset.pageIndex = String(pageIdx);
    slide.innerHTML = buildSlideContent(pageIdx);
    track.appendChild(slide);
  }

  // Position to show center slide (정수 픽셀 — 서브픽셀 반올림 방지)
  track.style.transition = 'none';
  track.style.transform = `translateX(-${vw}px)`;

  updatePageInfo();
  setupCarouselTouch(track);
  positionCoverChild();
}

function populateSlides() {
  // 전체 재생성 (jumpToPage, renderCarousel 용)
  const track = document.getElementById('carousel-track');
  if (!track) return;
  const slides = track.children;
  for (let i = 0; i < 3; i++) {
    const pageIdx = currentPageIndex + (i - 1);
    slides[i].dataset.pageIndex = String(pageIdx);
    slides[i].innerHTML = buildSlideContent(pageIdx);
  }
  positionCoverChild();
}

// 지연된 트랙 정규화: 애니메이션 끝나도 DOM 변경 안 함, 다음 상호작용 시 수행
let pendingNormalize = null; // { direction }

function normalizeTrackIfNeeded() {
  if (!pendingNormalize) return;
  const { direction } = pendingNormalize;
  pendingNormalize = null;

  const track = document.getElementById('carousel-track');
  if (!track) return;
  const vw = els.pageViewer.clientWidth;

  if (direction > 0) {
    const first = track.firstElementChild;
    track.appendChild(first);
    const newPageIdx = currentPageIndex + 1;
    first.dataset.pageIndex = String(newPageIdx);
    first.innerHTML = buildSlideContent(newPageIdx);
  } else {
    const last = track.lastElementChild;
    track.insertBefore(last, track.firstElementChild);
    const newPageIdx = currentPageIndex - 1;
    last.dataset.pageIndex = String(newPageIdx);
    last.innerHTML = buildSlideContent(newPageIdx);
  }

  track.style.transition = 'none';
  track.style.transform = `translateX(-${vw}px)`;
  track.offsetHeight;
  positionCoverChild();
}

function updatePageInfo() {
  const pages = getPages();
  const page = pages[currentPageIndex];
  const canPrev = currentPageIndex > 0;
  const canNext = currentPageIndex < pages.length - 1;

  const label = page.isCover ? page.title : `${page.scene}. ${page.title}`;
  const counter = `${currentPageIndex + 1} / ${pages.length}`;

  els.pageTitle.textContent = label;
  els.pageCounter.textContent = counter;
  if (els.pageCounterBottom) els.pageCounterBottom.textContent = counter;
  if (els.mPageTitle) els.mPageTitle.textContent = label;
  if (els.mPageCounter) els.mPageCounter.textContent = counter;

  els.prevBtn.disabled = !canPrev;
  els.nextBtn.disabled = !canNext;
  if (els.mPrevBtn) els.mPrevBtn.disabled = !canPrev;
  if (els.mNextBtn) els.mNextBtn.disabled = !canNext;

  // Highlight active thumbnail
  document.querySelectorAll('.thumb').forEach((t, i) => {
    t.classList.toggle('active', i === currentPageIndex);
  });
  const activeThumb = document.querySelector('.thumb.active');
  if (activeThumb) {
    activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

// ========== Carousel Navigation ==========

function goPage(delta) {
  if (isAnimating) return;
  resetZoom();
  normalizeTrackIfNeeded();

  const pages = getPages();
  const next = currentPageIndex + delta;
  if (next < 0 || next >= pages.length) return;

  isAnimating = true;
  const track = document.getElementById('carousel-track');
  if (!track) { isAnimating = false; return; }

  const vw = els.pageViewer.clientWidth;
  track.style.transition = 'transform 0.35s ease-out';
  track.style.transform = `translateX(-${delta > 0 ? vw * 2 : 0}px)`;

  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    currentPageIndex = next;
    pendingNormalize = { direction: delta };
    updatePageInfo();
    isAnimating = false;
  };

  track.addEventListener('transitionend', finalize, { once: true });
  setTimeout(() => { if (!finalized) finalize(); }, 400);
}

function jumpToPage(targetIndex) {
  if (isAnimating || targetIndex === currentPageIndex) return;
  resetZoom();
  normalizeTrackIfNeeded();
  const pages = getPages();
  if (targetIndex < 0 || targetIndex >= pages.length) return;

  // Adjacent page → slide
  const diff = targetIndex - currentPageIndex;
  if (Math.abs(diff) === 1) {
    goPage(diff);
    return;
  }

  // Non-adjacent → crossfade
  isAnimating = true;
  const track = document.getElementById('carousel-track');
  if (!track) { isAnimating = false; return; }

  track.style.transition = 'opacity 0.25s ease-out';
  track.style.opacity = '0';

  setTimeout(() => {
    currentPageIndex = targetIndex;
    track.style.transition = 'none';
    populateSlides();
    const vw = els.pageViewer.clientWidth;
    track.style.transform = `translateX(-${vw}px)`;
    track.offsetHeight;

    track.style.transition = 'opacity 0.25s ease-in';
    track.style.opacity = '1';

    updatePageInfo();
    setTimeout(() => { isAnimating = false; }, 260);
  }, 260);
}

// ========== Carousel Touch ==========

// ========== Pinch-to-Zoom ==========
let zoomScale = 1;
let zoomPanX = 0;
let zoomPanY = 0;
let isPinching = false;
let pinchStartDist = 0;
let pinchStartScale = 1;
let pinchStartPanX = 0;
let pinchStartPanY = 0;
let pinchMidX = 0;
let pinchMidY = 0;
let zoomEdgeOverflow = 0; // 가장자리 넘친 양 (페이지 스와이프용)

function getFingerDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function getCurrentWrap() {
  const track = document.getElementById('carousel-track');
  if (!track) return null;
  return track.children[1]?.querySelector('.slide-img-wrap');
}

function applyZoom() {
  const wrap = getCurrentWrap();
  if (!wrap) return;
  if (zoomScale <= 1) {
    wrap.style.transform = '';
    zoomScale = 1;
    zoomPanX = 0;
    zoomPanY = 0;
  } else {
    wrap.style.transform = `scale(${zoomScale}) translate(${zoomPanX}px, ${zoomPanY}px)`;
  }
}

function resetZoom() {
  zoomScale = 1;
  zoomPanX = 0;
  zoomPanY = 0;
  const wrap = getCurrentWrap();
  if (wrap) wrap.style.transform = '';
}

function setupCarouselTouch(track) {
  let startX = 0;
  let startY = 0;
  let isDragging = false;
  let deltaX = 0;
  let startTime = 0;
  // Pan while zoomed
  let panStartX = 0;
  let panStartY = 0;

  track.addEventListener('touchstart', (e) => {
    if (isAnimating || isEditingCoverPos) return;

    // 2 fingers → pinch zoom
    if (e.touches.length === 2) {
      isPinching = true;
      isDragging = false;
      pinchStartDist = getFingerDist(e.touches);
      pinchStartScale = zoomScale;
      pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      pinchStartPanX = zoomPanX;
      pinchStartPanY = zoomPanY;
      return;
    }

    // 1 finger
    if (zoomScale > 1) {
      // Zoomed → pan mode
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      pinchStartPanX = zoomPanX;
      pinchStartPanY = zoomPanY;
      isDragging = false;
      return;
    }

    normalizeTrackIfNeeded();
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    isDragging = false;
    deltaX = 0;
    track.style.transition = 'none';
  }, { passive: true });

  track.addEventListener('touchmove', (e) => {
    if (isAnimating || isEditingCoverPos) return;

    // Pinch zoom
    if (isPinching && e.touches.length === 2) {
      e.preventDefault();
      const dist = getFingerDist(e.touches);
      zoomScale = Math.min(4, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
      // Pan follows midpoint shift
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomPanX = pinchStartPanX + (midX - pinchMidX) / zoomScale;
      zoomPanY = pinchStartPanY + (midY - pinchMidY) / zoomScale;
      applyZoom();
      return;
    }

    // Pan while zoomed (1 finger)
    if (zoomScale > 1 && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStartX;
      const dy = e.touches[0].clientY - panStartY;

      const viewerW = els.pageViewer.clientWidth;
      const viewerH = els.pageViewer.clientHeight;
      const maxPanX = viewerW * (zoomScale - 1) / (2 * zoomScale);
      const maxPanY = viewerH * (zoomScale - 1) / (2 * zoomScale);

      const rawPanX = pinchStartPanX + dx / zoomScale;
      const rawPanY = pinchStartPanY + dy / zoomScale;

      // 클램핑
      zoomPanX = Math.max(-maxPanX, Math.min(maxPanX, rawPanX));
      zoomPanY = Math.max(-maxPanY, Math.min(maxPanY, rawPanY));
      applyZoom();

      // 가장자리 오버플로 → 페이지 스와이프용 축적
      if (rawPanX > maxPanX) {
        zoomEdgeOverflow = (rawPanX - maxPanX) * zoomScale;
      } else if (rawPanX < -maxPanX) {
        zoomEdgeOverflow = (rawPanX + maxPanX) * zoomScale;
      } else {
        zoomEdgeOverflow = 0;
      }
      return;
    }

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // Determine direction on first significant move
    if (!isDragging) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        isDragging = true;
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        return; // vertical scroll, don't interfere
      } else {
        return;
      }
    }

    deltaX = dx;
    const viewerWidth = els.pageViewer.clientWidth;
    const pages = getPages();

    // Rubber band at edges
    let adjustedDx = deltaX;
    if (currentPageIndex === 0 && deltaX > 0) adjustedDx = deltaX * 0.25;
    if (currentPageIndex === pages.length - 1 && deltaX < 0) adjustedDx = deltaX * 0.25;

    const baseOffset = -viewerWidth; // center slide position
    track.style.transform = `translateX(${baseOffset + adjustedDx}px)`;
  }, { passive: false });

  // 더블탭 → 줌 리셋
  let lastTapTime = 0;
  track.addEventListener('touchend', (e) => {
    if (isEditingCoverPos) return;
    if (e.touches.length === 0 && !isPinching && !isDragging && zoomScale > 1) {
      const now = Date.now();
      if (now - lastTapTime < 300) {
        resetZoom();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
    }

    // 핀치 종료
    if (isPinching) {
      isPinching = false;
      if (zoomScale < 1.05) {
        resetZoom();
      } else if (e.touches.length > 0) {
        // 2→1 손가락 전환: 남은 손가락 기준으로 pan 시작점 갱신 (점프 방지)
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        pinchStartPanX = zoomPanX;
        pinchStartPanY = zoomPanY;
      }
      return;
    }
    // 줌 상태에서 팬 종료 — 가장자리 넘치면 페이지 전환
    if (zoomScale > 1) {
      const viewerW = els.pageViewer.clientWidth;
      const pages = getPages();
      const swipeThreshold = viewerW * 0.15;
      if (zoomEdgeOverflow > swipeThreshold && currentPageIndex > 0) {
        resetZoom();
        goPage(-1);
      } else if (zoomEdgeOverflow < -swipeThreshold && currentPageIndex < pages.length - 1) {
        resetZoom();
        goPage(1);
      }
      zoomEdgeOverflow = 0;
      return;
    }

    if (!isDragging || isAnimating) return;

    const viewerWidth = els.pageViewer.clientWidth;
    const pages = getPages();
    const velocity = Math.abs(deltaX) / (Date.now() - startTime); // px/ms
    const threshold = viewerWidth * 0.2;
    const fastSwipe = velocity > 0.4;

    track.style.transition = 'transform 0.3s ease-out';

    if ((deltaX < -threshold || (fastSwipe && deltaX < -30)) && currentPageIndex < pages.length - 1) {
      // Swipe left → next
      isAnimating = true;
      track.style.transform = `translateX(-${viewerWidth * 2}px)`;

      let fin1 = false;
      const finalize = () => {
        if (fin1) return;
        fin1 = true;
        currentPageIndex++;
        pendingNormalize = { direction: 1 };
        updatePageInfo();
        isAnimating = false;
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (!fin1) finalize(); }, 350);

    } else if ((deltaX > threshold || (fastSwipe && deltaX > 30)) && currentPageIndex > 0) {
      // Swipe right → prev
      isAnimating = true;
      track.style.transform = 'translateX(0px)';

      let fin2 = false;
      const finalize = () => {
        if (fin2) return;
        fin2 = true;
        currentPageIndex--;
        pendingNormalize = { direction: -1 };
        updatePageInfo();
        isAnimating = false;
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (!fin2) finalize(); }, 350);

    } else {
      // Snap back
      track.style.transform = `translateX(-${viewerWidth}px)`;
    }
  }, { passive: true });
}

// ========== Thumbnails ==========

function renderThumbnails() {
  const pages = getPages();
  const strip = els.thumbnailStrip;
  strip.innerHTML = '';

  pages.forEach((page, i) => {
    const thumb = document.createElement('div');
    thumb.className = `thumb ${i === currentPageIndex ? 'active' : ''}`;

    if (page.isCover) {
      const coverBg = config.illustrations['golden_star'];
      thumb.innerHTML = `<img src="${coverBg}" alt="커버" /><div class="thumb-cover">커버</div>`;
    } else if (page.illustration && config.illustrations[page.illustration]) {
      const imgPath = config.illustrations[page.illustration];
      thumb.innerHTML = `<img src="${imgPath}" alt="${page.title}" /><span class="thumb-label">${page.scene}</span>`;
    } else {
      thumb.innerHTML = `<div class="thumb-gradient" style="background:${page.bgGradient || '#333'}"></div><span class="thumb-label">${page.scene}</span>`;
    }

    thumb.addEventListener('click', () => jumpToPage(i));
    strip.appendChild(thumb);
  });
}

// ========== Cover Photo (smart crop + remove.bg) ==========

const SMART_CROP_API = location.hostname.includes('github.io')
  ? 'https://cleveland-factors-mazda-removable.trycloudflare.com'
  : `http://${location.hostname}:5001`;

async function smartCropPerson(file) {
  const formData = new FormData();
  formData.append('file', file);
  const resp = await fetch(`${SMART_CROP_API}/smart-crop?crop_mode=person&seg_size=512`, {
    method: 'POST',
    body: formData
  });
  if (!resp.ok) return null;
  return await resp.json();
}

function cropImageOnCanvas(file, coords) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = coords.width;
      canvas.height = coords.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, coords.x, coords.y, coords.width, coords.height, 0, 0, coords.width, coords.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('크롭 Blob 생성 실패'));
      }, 'image/jpeg', 0.95);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function handleCoverPhoto(file) {
  if (isRemovingBg) return;
  isRemovingBg = true;

  // 이전 결과 정리
  if (coverPhotoOptions) {
    for (const opt of Object.values(coverPhotoOptions)) {
      if (opt && opt.url) URL.revokeObjectURL(opt.url);
    }
    coverPhotoOptions = null;
  }
  selectedModelKey = null;
  coverManualOffset = null;

  coverLoadingText = '인물을 감지하는 중...';
  renderCarousel();
  renderThumbnails();

  try {
    // Step 1: 스마트 크롭 — 인물 영역 감지 + 키포인트 저장
    let fileToSend = file;
    coverCropData = null;
    try {
      const cropResult = await smartCropPerson(file);
      if (cropResult && cropResult.keypoints) {
        if (cropResult.cropped && cropResult.crop) {
          console.log('스마트 크롭 적용:', cropResult.crop);
          try {
            const croppedBlob = await cropImageOnCanvas(file, cropResult.crop);
            fileToSend = new File([croppedBlob], file.name, { type: 'image/jpeg' });
            coverCropData = { keypoints: cropResult.keypoints, refX: cropResult.crop.x, refY: cropResult.crop.y, refWidth: cropResult.crop.width, refHeight: cropResult.crop.height };
          } catch (canvasErr) {
            // HEIC 등 브라우저에서 Canvas 로드 불가 → 원본 전송, 좌표계를 원본 기준으로 설정
            console.warn('캔버스 크롭 실패 (HEIC?), 원본 사용:', canvasErr.message);
            coverCropData = { keypoints: cropResult.keypoints, refX: 0, refY: 0, refWidth: cropResult.image_width, refHeight: cropResult.image_height };
          }
        } else {
          console.log('스마트 크롭 불필요 (키포인트만 저장)');
          coverCropData = { keypoints: cropResult.keypoints, refX: 0, refY: 0, refWidth: cropResult.image_width, refHeight: cropResult.image_height };
        }
      }
    } catch (e) {
      console.warn('스마트 크롭 스킵 (서버 미연결):', e.message);
    }

    // Step 2: 로컬 서버 배경 제거 (portrait + ben2 병렬 요청)
    coverLoadingText = '배경을 지우는 중...';
    renderCarousel();

    // 토글 즉시 표시 + 먼저 도착하는 결과를 자동 적용
    coverPhotoOptions = {};
    coverPhotoURL = null;
    selectedModelKey = null;
    renderCarousel(); // 토글(로딩 상태) + 스피너 즉시 표시

    const applyResult = (modelKey, opt) => {
      coverPhotoURL = opt.url;
      selectedModelKey = modelKey;
    };

    const extractAndShow = async (resp, modelKey) => {
      if (!resp.ok) return;
      const cropX = parseInt(resp.headers.get('X-Crop-X') || '0');
      const cropY = parseInt(resp.headers.get('X-Crop-Y') || '0');
      const blob = await resp.blob();

      // 캔버스로 원본(스마트크롭) 크기에 패딩 → 모든 모델 동일 크기
      let url;
      if (coverCropData && coverCropData.refWidth && (cropX > 0 || cropY > 0)) {
        url = await padImageToRef(blob, cropX, cropY, coverCropData.refWidth, coverCropData.refHeight);
      } else {
        url = URL.createObjectURL(blob);
      }

      const opt = { url };
      coverPhotoOptions[modelKey] = opt;

      // 첫 결과 또는 유저가 기다리고 있는 모델이면 적용
      if (!selectedModelKey || selectedModelKey === modelKey) {
        applyResult(modelKey, opt);
        coverLoadingText = '';
        isRemovingBg = false;
      }
      renderCarousel();
    };

    const promises = BG_REMOVE_MODELS.map(m => {
      const fd = new FormData();
      fd.append('file', fileToSend);
      return fetch(`${SMART_CROP_API}/remove-bg?model=${m.key}`, { method: 'POST', body: fd })
        .then(r => extractAndShow(r, m.key))
        .catch(e => console.warn(`${m.key} 실패:`, e));
    });

    await Promise.allSettled(promises);

    // 모두 실패한 경우
    if (Object.keys(coverPhotoOptions).length === 0) {
      coverPhotoOptions = null;
      throw new Error('모든 모델이 배경 제거에 실패했습니다.');
    }
  } catch (e) {
    console.error('배경 제거 실패:', e);
    alert('배경 제거에 실패했습니다.\n' + e.message);
  } finally {
    isRemovingBg = false;
    coverLoadingText = '';
    renderCarousel();
    renderThumbnails();
  }
}

function selectCoverModel(modelKey) {
  if (!coverPhotoOptions) return;
  selectedModelKey = modelKey;

  const chosen = coverPhotoOptions[modelKey];
  if (chosen) {
    // 결과 있음 — DOM 직접 업데이트 (배경 깜박임 방지)
    coverPhotoURL = chosen.url;
    const childImg = document.querySelector('.cover-child-img');
    if (childImg) {
      childImg.src = chosen.url;
      const pos = computeChildPosition();
      if (pos) {
        const mdx = coverManualOffset ? coverManualOffset.dx : 0;
        const mdy = coverManualOffset ? coverManualOffset.dy : 0;
        const tx = (pos.leftOffset - 50) + mdx;
        childImg.style.cssText = `height:${pos.height.toFixed(1)}%;top:${(pos.top + mdy).toFixed(1)}%;left:50%;transform:translateX(${tx.toFixed(1)}%)`;
      }
      // 스피너 레이아웃 있으면 제거
      const layout = document.querySelector('.cover-layout');
      if (layout) layout.remove();
    } else {
      // 아직 아이 사진 DOM 없음 (스피너 상태에서 전환) → 리렌더
      renderCarousel();
    }
  } else {
    // 아직 로딩 중 — 스피너 표시
    coverPhotoURL = null;
    renderCarousel();
  }
  // 토글 active 상태 갱신
  document.querySelectorAll('.model-toggle-option').forEach(el => {
    el.classList.toggle('active', el.dataset.model === modelKey);
  });
}

function startCoverPositionEdit() {
  isEditingCoverPos = true;
  if (!coverManualOffset) coverManualOffset = { dx: 0, dy: 0 };

  const childImg = document.querySelector('.cover-child-img');
  if (!childImg) return;

  // 확인/취소 버튼 추가
  const wrap = childImg.closest('.slide-img-wrap');
  if (!wrap) return;

  // 토글 비활성 + 힌트/액션 내용 교체 (높이 유지)
  const slide = wrap.closest('.carousel-slide');
  const toggleWrap = slide ? slide.querySelector('.model-toggle-wrap') : null;
  const menu = slide ? slide.querySelector('.cover-action-menu') : null;
  const toggleRow = toggleWrap ? toggleWrap.querySelector('.model-toggle') : null;
  const hintEl = toggleWrap ? toggleWrap.querySelector('.model-toggle-hint') : null;
  const savedHintText = hintEl ? hintEl.textContent : '';
  const savedMenuHTML = menu ? menu.innerHTML : '';
  if (toggleRow) { toggleRow.style.opacity = '0.3'; toggleRow.style.pointerEvents = 'none'; }
  if (hintEl) hintEl.textContent = '드래그하여 위치를 조정하세요';
  if (menu) {
    menu.innerHTML = `
      <button class="cover-pos-btn cover-pos-done">완료</button>
      <button class="cover-pos-btn cover-pos-reset">초기화</button>`;
  }

  // 드래그 이벤트
  let startX, startY, startDx, startDy;
  const onStart = (e) => {
    if (e.target.closest('.cover-pos-btn') || e.target.closest('.model-toggle-option')) return;
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    startDx = coverManualOffset.dx;
    startDy = coverManualOffset.dy;
    childImg.style.transition = 'none';
  };
  const onMove = (e) => {
    if (startX == null) return;
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    const wrapRect = wrap.getBoundingClientRect();
    const dx = ((pt.clientX - startX) / wrapRect.width) * 100;
    const dy = ((pt.clientY - startY) / wrapRect.height) * 100;
    coverManualOffset.dx = startDx + dx;
    coverManualOffset.dy = startDy + dy;
    applyCoverManualOffset(childImg);
  };
  const onEnd = () => {
    startX = null;
    childImg.style.transition = '';
  };

  const cleanup = () => {
    wrap.removeEventListener('mousedown', onStart);
    wrap.removeEventListener('touchstart', onStart);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchend', onEnd);
    if (toggleRow) { toggleRow.style.opacity = ''; toggleRow.style.pointerEvents = ''; }
    if (hintEl) hintEl.textContent = savedHintText;
    if (menu) menu.innerHTML = savedMenuHTML;
    isEditingCoverPos = false;
  };

  wrap.addEventListener('mousedown', onStart);
  wrap.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);

  const doneBtn = slide.querySelector('.cover-pos-done');
  const resetBtn = slide.querySelector('.cover-pos-reset');
  if (doneBtn) doneBtn.addEventListener('click', cleanup);
  if (resetBtn) resetBtn.addEventListener('click', () => {
    coverManualOffset = { dx: 0, dy: 0 };
    applyCoverManualOffset(childImg);
  });
}

function applyCoverManualOffset(childImg) {
  if (!childImg) childImg = document.querySelector('.cover-child-img');
  if (!childImg || !coverManualOffset) return;
  const pos = computeChildPosition();
  if (!pos) return;
  const tx = (pos.leftOffset - 50) + coverManualOffset.dx;
  const ty = coverManualOffset.dy;
  childImg.style.cssText = `height:${pos.height.toFixed(1)}%;top:${(pos.top + ty).toFixed(1)}%;left:50%;transform:translateX(${tx.toFixed(1)}%)`;
}

function setupCoverEvents() {
  const fileInput = document.getElementById('cover-photo-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleCoverPhoto(file);
    fileInput.value = ''; // reset so same file can be re-selected
  });

  // Delegate click on cover upload zone / photo result / toggle
  document.addEventListener('click', (e) => {
    // 토글 스위치
    const toggleOption = e.target.closest('.model-toggle-option');
    if (toggleOption) {
      const modelKey = toggleOption.dataset.model;
      if (modelKey) selectCoverModel(modelKey);
      return;
    }
    if (e.target.closest('#cover-upload-zone')) {
      fileInput.click();
      return;
    }
    const actionBtn = e.target.closest('.cover-action-btn');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === 'change') {
        fileInput.click();
      } else if (action === 'move') {
        startCoverPositionEdit();
      }
    }
  });
}

// ========== Event Handlers ==========

function setupEvents() {
  els.firstNameInput.addEventListener('input', () => { syncInputs('desktop'); updateVariables(); renderCarousel(); });
  els.parentNamesInput.addEventListener('input', () => { syncInputs('desktop'); updateVariables(); renderCarousel(); });
  els.mFirstNameInput.addEventListener('input', () => { syncInputs('mobile'); updateVariables(); renderCarousel(); });
  els.mParentNamesInput.addEventListener('input', () => { syncInputs('mobile'); updateVariables(); renderCarousel(); });

  els.versionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.versionBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll(`.version-btn[data-version="${btn.dataset.version}"]`)
        .forEach(b => b.classList.add('active'));
      currentVersion = btn.dataset.version;
      const pages = getPages();
      if (currentPageIndex >= pages.length) currentPageIndex = pages.length - 1;
      renderCarousel();
      renderThumbnails();
    });
  });

  els.prevBtn.addEventListener('click', () => goPage(-1));
  els.nextBtn.addEventListener('click', () => goPage(1));
  if (els.mPrevBtn) els.mPrevBtn.addEventListener('click', () => goPage(-1));
  if (els.mNextBtn) els.mNextBtn.addEventListener('click', () => goPage(1));

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') goPage(-1);
    else if (e.key === 'ArrowRight') goPage(1);
  });

  if (els.settingsBtn) {
    els.settingsBtn.addEventListener('click', () => els.settingsOverlay.classList.add('open'));
  }
  if (els.settingsBackdrop) {
    els.settingsBackdrop.addEventListener('click', () => els.settingsOverlay.classList.remove('open'));
  }
}

// ========== Init ==========

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  setupEvents();
  setupCoverEvents();
  loadConfig();
  window.addEventListener('resize', () => {
    // 슬라이드 너비 + 트랙 위치 갱신
    const vw = els.pageViewer.clientWidth;
    const track = document.getElementById('carousel-track');
    if (track) {
      for (const slide of track.children) slide.style.width = `${vw}px`;
      track.style.transition = 'none';
      track.style.transform = `translateX(-${vw}px)`;
    }
    positionCoverChild();
  });
});
