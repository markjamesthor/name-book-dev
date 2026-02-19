/**
 * 노미네 왕국 — Book Preview Engine
 * Config-Driven 동화책 미리보기 (Carousel)
 * Casetify-style 3-step mobile-first UI
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
let currentStep = 0; // 0=사진, 1=페이지, 2=스토리설정(바텀시트)
let variables = {};
let isAnimating = false;
let coverPhotoURL = null;
let isRemovingBg = false;
let coverLoadingText = '';
let coverCropData = null;
let coverPhotoOptions = null;
let selectedModelKey = null;
let coverManualOffset = null;
let isEditingCoverPos = false;
let coverCroppedFile = null;

// Multi-candidate cover photo system
let coverCandidates = [];
let activeCandidateIndex = -1;
let nextCandidateId = 0;
let pendingNudge = false; // trigger nudge after first bg-remove result

// Processing queue — one candidate at a time to avoid overwhelming the server
let processingQueue = [];
let isProcessingQueue = false;

const BG_REMOVE_MODELS = [
  { key: 'portrait', label: '1' },
  { key: 'ben2', label: '2' },
  { key: 'hr-matting', label: '3' },
  { key: 'removebg', label: '4' },
];

let useRemoveBg = localStorage.getItem('bookPreview_useRemoveBg') === 'true';

// ========== DOM ==========
const els = {};

function cacheDom() {
  els.firstNameInput = document.getElementById('input-firstName');
  els.parentNamesInput = document.getElementById('input-parentNames');
  els.versionBtns = document.querySelectorAll('.version-btn');
  els.pageViewer = document.getElementById('page-viewer');
  els.pageCounter = document.getElementById('page-counter');
  els.thumbnailStrip = document.getElementById('thumbnail-strip');
  els.stepTabs = document.querySelectorAll('.step-tab');
  els.stepContents = document.querySelectorAll('.step-content');
  els.coverControls = document.getElementById('cover-controls');
}

// ========== Step System ==========

function setStep(step) {
  // Step 2 = story sheet overlay
  if (step === 2) {
    openStorySheet();
    return;
  }
  currentStep = step;
  els.stepTabs.forEach(tab => {
    tab.classList.toggle('active', parseInt(tab.dataset.step) === step);
  });
  els.stepContents.forEach(content => {
    content.classList.toggle('active', content.id === `step-content-${step}`);
  });
  if (step === 0) renderCoverControls();
}

function openStorySheet() {
  document.getElementById('story-sheet-backdrop').classList.add('open');
  document.getElementById('story-sheet').classList.add('open');
}

function closeStorySheet() {
  document.getElementById('story-sheet-backdrop').classList.remove('open');
  document.getElementById('story-sheet').classList.remove('open');
}

function onPageChanged() {
  const pages = getPages();
  const page = pages[currentPageIndex];
  if (page && page.isCover) {
    setStep(0);
  } else if (currentStep === 0) {
    setStep(1);
  }
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

  updateVariables();
  renderCarousel();
  renderThumbnails();
  renderCoverControls();
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

  const leftOffset = 50 - eyeX * 100;

  console.log(`아이 배치: eye=${ey.toFixed(3)} hip=${hipY.toFixed(3)} eyeX=${eyeX.toFixed(3)} → height=${h.toFixed(1)}% top=${t.toFixed(1)}% leftOff=${leftOffset.toFixed(1)}%`);
  return { height: h, top: t, leftOffset };
}

function computeChildPosition() {
  return computeChildPositionWith(0, coverCropData?.refHeight);
}

// Build cover visual only (no controls — those go to renderCoverControls)
function buildCoverContent() {
  const bgPath = config.illustrations['golden_star'];
  const coverTitle = `내 이름은 왜 ${variables.firstName}이야?`;
  const titleStyle = getCoverTitleStyle();
  const titleHtml = `<div class="cover-top-title"${titleStyle ? ` style="${titleStyle}"` : ''}><div class="cover-top-title-text">${coverTitle}</div></div>`;

  const frontStyle = getCoverLayoutStyle();
  let imgContent = `<div class="page-bg-blur" style="background-image:url('${bgPath}')"></div>
    <img class="page-bg-img" src="${bgPath}" alt="커버" style="object-fit:contain;object-position:center;" />
    <div class="cover-front-wrap"${frontStyle ? ` style="${frontStyle}"` : ''}><img class="cover-front-img" src="NAME/cover_front.png" /></div>`;

  // Child photo displayed
  const selectedOpt = selectedModelKey && coverPhotoOptions && coverPhotoOptions[selectedModelKey];
  if (selectedOpt && coverPhotoURL) {
    const pos = computeChildPosition();
    let childStyle;
    if (pos) {
      const mdx = coverManualOffset ? coverManualOffset.dx : 0;
      const mdy = coverManualOffset ? coverManualOffset.dy : 0;
      const rot = coverManualOffset ? (coverManualOffset.rotation || 0) : 0;
      const tx = (pos.leftOffset - 50) + mdx;
      childStyle = `height:${pos.height.toFixed(1)}%;top:${(pos.top + mdy).toFixed(1)}%;left:50%;transform:translateX(${tx.toFixed(1)}%) rotate(${rot}deg)`;
    } else {
      const rot = coverManualOffset ? (coverManualOffset.rotation || 0) : 0;
      childStyle = `height:80%;bottom:0;left:50%;transform:translateX(-50%) rotate(${rot}deg)`;
    }
    const wrapStyle = getCoverLayoutStyle();
    const nudgeClass = pendingNudge ? ' nudge' : '';
    const showDragHint = pendingNudge && !localStorage.getItem('bookPreview_dragHintSeen');
    imgContent += `<div class="cover-child-wrap${nudgeClass}"${wrapStyle ? ` style="${wrapStyle}"` : ''}><img class="cover-child-img" src="${coverPhotoURL}" style="${childStyle}" /></div>`;
    if (showDragHint) {
      imgContent += `<div class="cover-drag-hint">터치해서 위치를 조정하세요</div>`;
      localStorage.setItem('bookPreview_dragHintSeen', '1');
    }
    if (pendingNudge) pendingNudge = false;

    // Model toggle inside the card
    const activeModels = BG_REMOVE_MODELS.filter(m => m.key !== 'removebg' || useRemoveBg);
    let activeIdx = 0;
    const toggleOpts = activeModels.map((m, idx) => {
      const loaded = !!coverPhotoOptions[m.key];
      const active = selectedModelKey === m.key;
      let cls = 'model-toggle-option';
      if (active) { cls += ' active'; activeIdx = idx; }
      if (!loaded) cls += ' model-toggle-loading';
      return `<div class="${cls}" data-model="${m.key}" data-idx="${idx}">${m.label}</div>`;
    }).join('');
    const indicatorHtml = `<div class="model-toggle-indicator" style="transform:translateX(${activeIdx * 46}px)"></div>`;
    const toggleHtml = `<div class="cover-model-overlay">
      <div class="model-toggle model-toggle-large">${indicatorHtml}${toggleOpts}</div>
      <div class="model-toggle-hint">숫자를 눌러 배경이 가장 잘 지워진 사진을 골라주세요</div>
    </div>`;

    return `<div class="slide-img-wrap">${imgContent}${titleHtml}</div>${toggleHtml}`;
  }

  // Loading state — spinner in carousel
  if (isRemovingBg) {
    return `
      <div class="slide-img-wrap">${imgContent}${titleHtml}</div>
      <div class="cover-layout"><div class="cover-loading">
        <div class="cover-spinner"></div>
        <div class="cover-loading-text">${coverLoadingText || '처리 중...'}</div>
      </div></div>`;
  }

  // No photo — hint to use 사진 tab
  return `
    <div class="slide-img-wrap">${imgContent}${titleHtml}</div>
`;
}

// Update candidate list DOM — preserves <img> elements to avoid reload flicker
function updateCandidateList() {
  const container = els.coverControls;
  if (!container) return;

  let listEl = container.querySelector('.candidate-list');

  if (coverCandidates.length === 0) {
    if (listEl) listEl.remove();
    return;
  }

  // Create list if missing
  if (!listEl) {
    listEl = document.createElement('div');
    listEl.className = 'candidate-list';
    listEl.innerHTML = '<button class="candidate-add" id="cover-add-btn">+</button>';
    container.prepend(listEl);
  }

  const existingThumbs = listEl.querySelectorAll('.candidate-thumb');
  const addBtn = listEl.querySelector('.candidate-add');

  // Add new thumbs (only for candidates that don't have a DOM element yet)
  for (let i = existingThumbs.length; i < coverCandidates.length; i++) {
    const c = coverCandidates[i];
    const div = document.createElement('div');
    div.className = 'candidate-thumb';
    div.dataset.candidateIndex = String(i);
    const img = document.createElement('img');
    img.src = c.thumbURL;
    img.alt = '';
    div.appendChild(img);
    listEl.insertBefore(div, addBtn);
  }

  // Update classes + img src on all thumbs
  listEl.querySelectorAll('.candidate-thumb').forEach((el, i) => {
    if (i >= coverCandidates.length) return;
    const c = coverCandidates[i];
    el.classList.toggle('active', i === activeCandidateIndex);
    el.classList.toggle('processing', c.isProcessing);
    // Sync img src if changed (e.g., placeholder → real thumb from server)
    const img = el.querySelector('img');
    if (img && img.src !== c.thumbURL) img.src = c.thumbURL;
    // Spinner
    const spinner = el.querySelector('.candidate-spinner');
    if (c.isProcessing && !spinner) {
      const s = document.createElement('div');
      s.className = 'candidate-spinner';
      el.appendChild(s);
    } else if (!c.isProcessing && spinner) {
      spinner.remove();
    }
  });
}

// Render cover controls in bottom panel (step-2)
function renderCoverControls() {
  if (!els.coverControls) return;

  // Preserve candidate list (img elements stay in DOM)
  updateCandidateList();

  // Get or create status container
  let statusEl = els.coverControls.querySelector('.cover-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.className = 'cover-status';
    els.coverControls.appendChild(statusEl);
  }

  const selectedOpt = selectedModelKey && coverPhotoOptions && coverPhotoOptions[selectedModelKey];

  // Photo exists with result — toggle is now inside the card
  if (selectedOpt && coverPhotoURL) {
    statusEl.innerHTML = '';
    return;
  }

  // Loading state — thumbnail spinner handles it now
  if (coverPhotoOptions || isRemovingBg) {
    statusEl.innerHTML = '';
    return;
  }

  // No photo — upload button
  if (coverCandidates.length === 0) {
    statusEl.innerHTML = `
      <button class="cover-upload-btn" id="cover-upload-btn">
        사진 선택하기
      </button>
      <div style="font-size:12px;color:#1a1a1a;text-align:center;margin-top:4px;">동화책에 들어갈 아이 사진을 <b>여러장</b> 업로드 하세요</div>`;
  } else {
    statusEl.innerHTML = '';
  }
}

function buildSlideContent(pageIndex) {
  const pages = getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) return '';

  const page = pages[pageIndex];

  if (page.isCover) return buildCoverContent();

  let imgContent = '';
  let imgPath = '';
  if (page.illustration && config.illustrations[page.illustration]) {
    imgPath = config.illustrations[page.illustration];
    imgContent = `<div class="page-bg-blur" style="background-image:url('${imgPath}')"></div>
      <img class="page-bg-img" src="${imgPath}" alt="${page.title}" style="object-fit:cover;object-position:top center;" />`;
  } else if (page.bgGradient) {
    imgContent = `<div class="page-bg-gradient" style="background:${page.bgGradient}"></div>`;
  }

  const text = substituteVars(page.text, variables);
  const textColor = page.textColor || 'white';
  const posClass = `text-pos-${page.textPosition || 'center'}`;
  const bgVar = imgPath ? `--page-bg-url:url('${imgPath}');` : '';

  return `
    <div class="slide-img-wrap">${imgContent}</div>
    <div class="page-text-overlay ${posClass}" style="${bgVar}color:${textColor}">
      <div class="page-text-scroll">
        <div class="page-story-text">${text.replace(/\n/g, '<br>')}</div>
      </div>
    </div>`;
}

let coverBgNatSize = null;
let cachedCoverLayout = null;

function getCoverLayoutStyle() {
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
  const track = document.getElementById('carousel-track');
  if (!track) return;
  let wrap = null;
  for (const slide of track.children) {
    const w = slide.querySelector('.slide-img-wrap');
    if (w && w.querySelector('.cover-top-title')) { wrap = w; break; }
  }
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

  cachedCoverLayout = { imgX, imgY, imgW, imgH };

  const childWrap = wrap.querySelector('.cover-child-wrap');
  if (childWrap) {
    childWrap.style.left = `${imgX}px`;
    childWrap.style.top = `${imgY}px`;
    childWrap.style.width = `${imgW}px`;
    childWrap.style.height = `${imgH}px`;
  }

  const frontWrap = wrap.querySelector('.cover-front-wrap');
  if (frontWrap) {
    frontWrap.style.left = `${imgX}px`;
    frontWrap.style.top = `${imgY}px`;
    frontWrap.style.width = `${imgW}px`;
    frontWrap.style.height = `${imgH}px`;
  }

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
  const slideGap = 8;
  for (let i = -1; i <= 1; i++) {
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';
    slide.style.width = `${vw - slideGap}px`;
    slide.style.marginLeft = `${slideGap / 2}px`;
    slide.style.marginRight = `${slideGap / 2}px`;
    const pageIdx = currentPageIndex + i;
    slide.dataset.pageIndex = String(pageIdx);
    const pages = getPages();
    if (pageIdx >= 0 && pageIdx < pages.length && pages[pageIdx].isCover) {
      slide.classList.add('slide-cover');
    }
    slide.innerHTML = buildSlideContent(pageIdx);
    track.appendChild(slide);
  }

  track.style.transition = 'none';
  track.style.transform = `translateX(-${vw}px)`;

  updatePageInfo();
  setupCarouselTouch(track);
  positionCoverChild();
  renderCoverControls();
}

function populateSlides() {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  const pages = getPages();
  const slides = track.children;
  for (let i = 0; i < 3; i++) {
    const pageIdx = currentPageIndex + (i - 1);
    slides[i].dataset.pageIndex = String(pageIdx);
    slides[i].classList.toggle('slide-cover', pageIdx >= 0 && pageIdx < pages.length && pages[pageIdx].isCover);
    slides[i].innerHTML = buildSlideContent(pageIdx);
  }
  positionCoverChild();
}

let pendingNormalize = null;

function normalizeTrackIfNeeded() {
  if (!pendingNormalize) return;
  const { direction } = pendingNormalize;
  pendingNormalize = null;

  const track = document.getElementById('carousel-track');
  if (!track) return;
  const vw = els.pageViewer.clientWidth;

  const pages = getPages();
  if (direction > 0) {
    const first = track.firstElementChild;
    track.appendChild(first);
    const newPageIdx = currentPageIndex + 1;
    first.dataset.pageIndex = String(newPageIdx);
    first.classList.toggle('slide-cover', newPageIdx >= 0 && newPageIdx < pages.length && pages[newPageIdx].isCover);
    first.innerHTML = buildSlideContent(newPageIdx);
  } else {
    const last = track.lastElementChild;
    track.insertBefore(last, track.firstElementChild);
    const newPageIdx = currentPageIndex - 1;
    last.dataset.pageIndex = String(newPageIdx);
    last.classList.toggle('slide-cover', newPageIdx >= 0 && newPageIdx < pages.length && pages[newPageIdx].isCover);
    last.innerHTML = buildSlideContent(newPageIdx);
  }

  track.style.transition = 'none';
  track.style.transform = `translateX(-${vw}px)`;
  track.offsetHeight;
  positionCoverChild();
}

function updatePageInfo() {
  const pages = getPages();
  const counter = currentPageIndex === 0 ? '커버' : `${currentPageIndex} / ${pages.length - 1}`;
  els.pageCounter.textContent = counter;

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
    positionCoverChild();
    isAnimating = false;
    onPageChanged();
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

  const diff = targetIndex - currentPageIndex;
  if (Math.abs(diff) === 1) {
    goPage(diff);
    return;
  }

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
    setTimeout(() => {
      isAnimating = false;
      onPageChanged();
    }, 260);
  }, 260);
}

// ========== Carousel Touch ==========

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
let zoomEdgeOverflow = 0;

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
  let panStartX = 0;
  let panStartY = 0;

  // Cover child drag state
  let childDragImg = null;
  let childDragWrap = null;
  let childDragStartX = 0;
  let childDragStartY = 0;
  let childDragStartDx = 0;
  let childDragStartDy = 0;
  let childDragPending = false; // waiting to confirm single-finger drag
  // Child rotation state (two-finger)
  let childRotating = false;
  let childRotStartAngle = 0;
  let childRotStartRotation = 0;

  track.addEventListener('touchstart', (e) => {
    if (isAnimating) return;

    // If a second finger arrives while child drag is pending → switch to rotation
    if (childDragPending && e.touches.length === 2) {
      childDragPending = false;
      isEditingCoverPos = true;
      childRotating = true;
      const t = e.touches;
      childRotStartAngle = Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
      childRotStartRotation = coverManualOffset ? (coverManualOffset.rotation || 0) : 0;
      return;
    }

    // Prepare cover child drag (don't commit yet — wait for move to confirm)
    if (!isPinching && !childDragPending && e.touches.length === 1) {
      const childWrap = e.target.closest('.cover-child-wrap');
      if (childWrap) {
        const img = childWrap.querySelector('.cover-child-img');
        if (img) {
          if (!coverManualOffset) coverManualOffset = { dx: 0, dy: 0, rotation: 0 };
          childDragImg = img;
          childDragWrap = img.closest('.slide-img-wrap');
          childDragStartX = e.touches[0].clientX;
          childDragStartY = e.touches[0].clientY;
          childDragStartDx = coverManualOffset.dx;
          childDragStartDy = coverManualOffset.dy;
          childDragPending = true;
          // Don't set isEditingCoverPos yet — allow pinch to take over
          return;
        }
      }
    }

    if (isEditingCoverPos) return;

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

    if (zoomScale > 1) {
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
    if (isAnimating) return;

    // Child rotation (two-finger on child photo)
    if (childRotating && childDragImg && e.touches.length === 2) {
      e.preventDefault();
      if (!coverManualOffset) coverManualOffset = { dx: 0, dy: 0, rotation: 0 };
      const t = e.touches;
      const angle = Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
      coverManualOffset.rotation = childRotStartRotation + (angle - childRotStartAngle);
      childDragImg.style.transition = 'none';
      applyCoverManualOffset(childDragImg);
      return;
    }

    // Cover child drag: pending → confirm or cancel
    if (childDragPending && childDragImg) {
      if (e.touches.length >= 2) {
        // Second finger arrived → switch to rotation
        childDragPending = false;
        isEditingCoverPos = true;
        childRotating = true;
        const t = e.touches;
        childRotStartAngle = Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
        childRotStartRotation = coverManualOffset ? (coverManualOffset.rotation || 0) : 0;
        return;
      } else {
        // Single finger move → confirm child drag
        childDragPending = false;
        isEditingCoverPos = true;
        childDragImg.style.transition = 'none';
        // Fall through to drag below
      }
    }

    // Cover child drag move
    if (childDragImg && isEditingCoverPos && !isPinching) {
      e.preventDefault();
      const pt = e.touches[0];
      const wrapRect = childDragWrap.getBoundingClientRect();
      const dx = ((pt.clientX - childDragStartX) / wrapRect.width) * 100;
      const dy = ((pt.clientY - childDragStartY) / wrapRect.height) * 100;
      coverManualOffset.dx = childDragStartDx + dx;
      coverManualOffset.dy = childDragStartDy + dy;
      applyCoverManualOffset(childDragImg);
      return;
    }

    if (isEditingCoverPos) return;

    if (isPinching && e.touches.length === 2) {
      e.preventDefault();
      const dist = getFingerDist(e.touches);
      zoomScale = Math.min(4, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomPanX = pinchStartPanX + (midX - pinchMidX) / zoomScale;
      zoomPanY = pinchStartPanY + (midY - pinchMidY) / zoomScale;
      applyZoom();
      return;
    }

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

      zoomPanX = Math.max(-maxPanX, Math.min(maxPanX, rawPanX));
      zoomPanY = Math.max(-maxPanY, Math.min(maxPanY, rawPanY));
      applyZoom();

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

    if (!isDragging) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        isDragging = true;
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        return;
      } else {
        return;
      }
    }

    deltaX = dx;
    const viewerWidth = els.pageViewer.clientWidth;
    const pages = getPages();

    let adjustedDx = deltaX;
    if (currentPageIndex === 0 && deltaX > 0) adjustedDx = deltaX * 0.25;
    if (currentPageIndex === pages.length - 1 && deltaX < 0) adjustedDx = deltaX * 0.25;

    const baseOffset = -viewerWidth;
    track.style.transform = `translateX(${baseOffset + adjustedDx}px)`;
  }, { passive: false });

  let lastTapTime = 0;
  track.addEventListener('touchend', (e) => {
    // Child rotation end — if one finger lifts, stop rotating but keep state
    if (childRotating && e.touches.length < 2) {
      childRotating = false;
      if (e.touches.length === 0) {
        if (childDragImg) childDragImg.style.transition = '';
        childDragImg = null;
        childDragWrap = null;
        isEditingCoverPos = false;
        saveGlobalsToActiveCandidate();
        return;
      }
      // One finger remaining — don't start swipe
      return;
    }
    // Cover child drag end (or pending cancelled by lift)
    if (childDragPending || (childDragImg && isEditingCoverPos)) {
      if (childDragImg) childDragImg.style.transition = '';
      childDragPending = false;
      childDragImg = null;
      childDragWrap = null;
      if (isEditingCoverPos) {
        isEditingCoverPos = false;
        saveGlobalsToActiveCandidate();
      }
      return;
    }

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

    if (isPinching) {
      isPinching = false;
      if (zoomScale < 1.05) {
        resetZoom();
        // Prevent remaining finger from triggering swipe with stale startX
        if (e.touches.length > 0) {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          startTime = Date.now();
          isDragging = false;
          deltaX = 0;
        }
      } else if (e.touches.length > 0) {
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        pinchStartPanX = zoomPanX;
        pinchStartPanY = zoomPanY;
      }
      return;
    }
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
    const velocity = Math.abs(deltaX) / (Date.now() - startTime);
    const threshold = viewerWidth * 0.2;
    const fastSwipe = velocity > 0.4;

    track.style.transition = 'transform 0.3s ease-out';

    if ((deltaX < -threshold || (fastSwipe && deltaX < -30)) && currentPageIndex < pages.length - 1) {
      isAnimating = true;
      track.style.transform = `translateX(-${viewerWidth * 2}px)`;

      let fin1 = false;
      const finalize = () => {
        if (fin1) return;
        fin1 = true;
        currentPageIndex++;
        pendingNormalize = { direction: 1 };
        updatePageInfo();
        positionCoverChild();
        isAnimating = false;
        onPageChanged();
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (!fin1) finalize(); }, 350);

    } else if ((deltaX > threshold || (fastSwipe && deltaX > 30)) && currentPageIndex > 0) {
      isAnimating = true;
      track.style.transform = 'translateX(0px)';

      let fin2 = false;
      const finalize = () => {
        if (fin2) return;
        fin2 = true;
        currentPageIndex--;
        pendingNormalize = { direction: -1 };
        updatePageInfo();
        positionCoverChild();
        isAnimating = false;
        onPageChanged();
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (!fin2) finalize(); }, 350);

    } else {
      track.style.transform = `translateX(-${viewerWidth}px)`;
    }
  }, { passive: true });
}

// ========== Thumbnails ==========

function renderThumbnails() {
  const pages = getPages();
  const strip = els.thumbnailStrip;
  strip.innerHTML = '';

  const needPhotoPages = new Set([0, 1, 17]);

  pages.forEach((page, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';

    const thumb = document.createElement('div');
    thumb.className = `thumb ${i === currentPageIndex ? 'active' : ''}`;

    if (page.isCover) {
      const coverBg = config.illustrations['golden_star'];
      thumb.innerHTML = `<img src="${coverBg}" alt="커버" /><div class="thumb-cover">커버</div>`;
    } else if (page.illustration && config.illustrations[page.illustration]) {
      const imgPath = config.illustrations[page.illustration];
      thumb.innerHTML = `<img src="${imgPath}" alt="${page.title}" /><span class="thumb-label">${i}</span>`;
    } else {
      thumb.innerHTML = `<div class="thumb-gradient" style="background:${page.bgGradient || '#333'}"></div><span class="thumb-label">${i}</span>`;
    }

    thumb.addEventListener('click', () => jumpToPage(i));
    wrap.appendChild(thumb);

    if (needPhotoPages.has(i) && !coverPhotoURL) {
      const label = document.createElement('div');
      label.className = 'thumb-need-photo';
      label.textContent = '사진 필요';
      wrap.appendChild(label);
    }

    strip.appendChild(wrap);
  });
}

// ========== Cover Photo (smart crop + remove.bg) ==========

const SMART_CROP_API = location.hostname.includes('github.io')
  ? 'https://ai.monviestory.co.kr'
  : 'http://59.10.238.17:5001';

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

// ========== Multi-Candidate Helpers ==========

async function createPhotoThumb(file) {
  // 1) createImageBitmap (HEIC on Safari, all standard formats)
  try {
    const bitmap = await createImageBitmap(file);
    const size = 104;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - s) / 2;
    const sy = (bitmap.height - s) / 2;
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size);
    bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    if (dataUrl.length > 1000) return dataUrl;
  } catch (e) {}

  // 2) Image element fallback
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const size = 104;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2;
        const sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
        URL.revokeObjectURL(blobUrl);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(); };
      img.src = blobUrl;
    });
    if (dataUrl.length > 1000) return dataUrl;
  } catch (e) {}

  // 3) Placeholder (HEIC on Chrome etc.)
  const canvas = document.createElement('canvas');
  canvas.width = 104;
  canvas.height = 104;
  const ctx = canvas.getContext('2d');
  const hash = Array.from(file.name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffffff, 0);
  ctx.fillStyle = `hsl(${hash % 360}, 45%, 75%)`;
  ctx.fillRect(0, 0, 104, 104);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u{1F4F7}', 52, 56);
  return canvas.toDataURL('image/png');
}

function syncCandidateToGlobals(c) {
  coverPhotoURL = c.photoURL;
  coverPhotoOptions = c.photoOptions;
  selectedModelKey = c.selectedModelKey;
  coverManualOffset = c.manualOffset;
  coverCropData = c.cropData;
  coverCroppedFile = c.croppedFile;
  isRemovingBg = c.isProcessing;
  coverLoadingText = c.loadingText;
}

function saveGlobalsToActiveCandidate() {
  if (activeCandidateIndex < 0 || activeCandidateIndex >= coverCandidates.length) return;
  const c = coverCandidates[activeCandidateIndex];
  c.photoURL = coverPhotoURL;
  c.photoOptions = coverPhotoOptions;
  c.selectedModelKey = selectedModelKey;
  c.manualOffset = coverManualOffset;
  c.cropData = coverCropData;
  c.croppedFile = coverCroppedFile;
  c.isProcessing = isRemovingBg;
  c.loadingText = coverLoadingText;
}

function switchCandidate(index) {
  if (index === activeCandidateIndex) return;
  if (index < 0 || index >= coverCandidates.length) return;
  saveGlobalsToActiveCandidate();
  activeCandidateIndex = index;
  syncCandidateToGlobals(coverCandidates[index]);
  renderCarousel();
  renderCoverControls();
}

async function processCandidate(candidate) {
  const isActive = () => coverCandidates[activeCandidateIndex] === candidate;
  const syncAndRender = () => {
    if (isActive()) {
      syncCandidateToGlobals(candidate);
      renderCarousel();
    }
    renderCoverControls();
  };

  candidate.isProcessing = true;
  candidate.loadingText = '인물을 감지하는 중...';
  syncAndRender();

  try {
    let fileToSend = candidate.originalFile;
    candidate.cropData = null;
    try {
      const cropResult = await smartCropPerson(candidate.originalFile);
      if (cropResult && cropResult.keypoints) {
        if (cropResult.cropped && cropResult.crop) {
          console.log('스마트 크롭 적용:', cropResult.crop);
          try {
            const croppedBlob = await cropImageOnCanvas(candidate.originalFile, cropResult.crop);
            fileToSend = new File([croppedBlob], candidate.originalFile.name, { type: 'image/jpeg' });
            candidate.cropData = { keypoints: cropResult.keypoints, refX: cropResult.crop.x, refY: cropResult.crop.y, refWidth: cropResult.crop.width, refHeight: cropResult.crop.height };
          } catch (canvasErr) {
            console.warn('캔버스 크롭 실패:', canvasErr.message);
            candidate.cropData = { keypoints: cropResult.keypoints, refX: 0, refY: 0, refWidth: cropResult.image_width, refHeight: cropResult.image_height };
          }
        } else {
          candidate.cropData = { keypoints: cropResult.keypoints, refX: 0, refY: 0, refWidth: cropResult.image_width, refHeight: cropResult.image_height };
        }
      }
    } catch (e) {
      console.warn('스마트 크롭 스킵:', e.message);
    }

    candidate.croppedFile = fileToSend;
    candidate.loadingText = '배경을 지우는 중...';
    candidate.photoOptions = {};
    candidate.photoURL = null;
    candidate.selectedModelKey = null;
    syncAndRender();

    const extractAndApply = async (resp, modelKey) => {
      if (!resp.ok) return;
      const cropX = parseInt(resp.headers.get('X-Crop-X') || '0');
      const cropY = parseInt(resp.headers.get('X-Crop-Y') || '0');
      const blob = await resp.blob();

      // Update placeholder thumbnail with actual image from server result
      // Center on eye midpoint if keypoints available
      if (!candidate._thumbFromResult) {
        try {
          const bm = await createImageBitmap(blob);
          const sz = 104, cv = document.createElement('canvas');
          cv.width = sz; cv.height = sz;
          const cx = cv.getContext('2d');

          // Default: center crop
          let srcSize = Math.min(bm.width, bm.height);
          let srcX = (bm.width - srcSize) / 2;
          let srcY = (bm.height - srcSize) / 2;

          // Eye-centered cropping
          if (candidate.cropData && candidate.cropData.keypoints) {
            const kps = candidate.cropData.keypoints;
            const rX = candidate.cropData.refX || 0;
            const rY = candidate.cropData.refY || 0;
            const eyeL = kps.find(k => k.name === 'left_eye' && k.score > 0.3);
            const eyeR = kps.find(k => k.name === 'right_eye' && k.score > 0.3);

            if (eyeL || eyeR) {
              const eyes = [eyeL, eyeR].filter(Boolean);
              // Map keypoints from original image → blob coordinates
              const midX = eyes.reduce((s, k) => s + (k.x - rX - cropX), 0) / eyes.length;
              const midY = eyes.reduce((s, k) => s + (k.y - rY - cropY), 0) / eyes.length;

              // Crop size: 4x eye distance (shows face + context), or 60% of shorter side
              if (eyeL && eyeR) {
                const eyeDist = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y);
                srcSize = Math.min(Math.max(eyeDist * 4, 80), bm.width, bm.height);
              } else {
                srcSize = Math.min(bm.width, bm.height) * 0.6;
              }

              // Center on eye midpoint, clamp to bitmap bounds
              srcX = Math.max(0, Math.min(midX - srcSize / 2, bm.width - srcSize));
              srcY = Math.max(0, Math.min(midY - srcSize / 2, bm.height - srcSize));
            }
          }

          cx.fillStyle = '#f0f0f0';
          cx.fillRect(0, 0, sz, sz);
          cx.drawImage(bm, srcX, srcY, srcSize, srcSize, 0, 0, sz, sz);
          bm.close();
          const du = cv.toDataURL('image/jpeg', 0.85);
          if (du.length > 1000) {
            candidate.thumbURL = du;
            candidate._thumbFromResult = true;
          }
        } catch (e) {}
      }

      let url;
      if (candidate.cropData && candidate.cropData.refWidth && (cropX > 0 || cropY > 0)) {
        url = await padImageToRef(blob, cropX, cropY, candidate.cropData.refWidth, candidate.cropData.refHeight);
      } else {
        url = URL.createObjectURL(blob);
      }

      candidate.photoOptions[modelKey] = { url };
      const isFirstResult = !candidate.selectedModelKey;
      if (!candidate.selectedModelKey || candidate.selectedModelKey === modelKey) {
        candidate.photoURL = url;
        candidate.selectedModelKey = modelKey;
        candidate.loadingText = '';
        candidate.isProcessing = false;
      }
      if (isFirstResult && coverCandidates[activeCandidateIndex] === candidate) {
        pendingNudge = true;
      }
      syncAndRender();
    };

    const activeModels = BG_REMOVE_MODELS.filter(m => m.key !== 'removebg' || useRemoveBg);
    const promises = activeModels.map(m => {
      const fd = new FormData();
      fd.append('file', fileToSend);
      return fetch(`${SMART_CROP_API}/remove-bg?model=${m.key}`, { method: 'POST', body: fd })
        .then(r => extractAndApply(r, m.key))
        .catch(e => console.warn(`${m.key} 실패:`, e));
    });
    await Promise.allSettled(promises);

    if (Object.keys(candidate.photoOptions).length === 0) {
      candidate.photoOptions = null;
      throw new Error('모든 모델이 배경 제거에 실패했습니다.');
    }
  } catch (e) {
    console.error('배경 제거 실패:', e);
  } finally {
    candidate.isProcessing = false;
    candidate.loadingText = '';
    syncAndRender();
  }
}

function enqueueCandidate(candidate) {
  processingQueue.push(candidate);
  if (!isProcessingQueue) runProcessingQueue();
}

async function runProcessingQueue() {
  isProcessingQueue = true;
  while (processingQueue.length > 0) {
    // Pick up to 3, prioritizing active candidate
    const batch = [];
    const activeCandidate = coverCandidates[activeCandidateIndex];
    const activeIdx = processingQueue.findIndex(c => c === activeCandidate);
    if (activeIdx !== -1) batch.push(processingQueue.splice(activeIdx, 1)[0]);
    while (batch.length < 3 && processingQueue.length > 0) {
      batch.push(processingQueue.shift());
    }
    await Promise.allSettled(batch.map(c => processCandidate(c)));
  }
  isProcessingQueue = false;
}

async function handleCoverPhotos(files) {
  const fileArr = Array.from(files);
  if (fileArr.length === 0) return;

  if (currentPageIndex !== 0) jumpToPage(0);

  const firstNewIndex = coverCandidates.length;
  for (const file of fileArr) {
    const thumbURL = await createPhotoThumb(file);
    const candidate = {
      id: nextCandidateId++,
      thumbURL,
      originalFile: file,
      croppedFile: null,
      cropData: null,
      photoOptions: null,
      selectedModelKey: null,
      photoURL: null,
      manualOffset: null,
      isProcessing: false,
      loadingText: ''
    };
    coverCandidates.push(candidate);
    enqueueCandidate(candidate);
  }

  // Switch to first new candidate
  saveGlobalsToActiveCandidate();
  activeCandidateIndex = firstNewIndex;
  syncCandidateToGlobals(coverCandidates[firstNewIndex]);
  renderCarousel();
  renderCoverControls();
}

function selectCoverModel(modelKey) {
  if (!coverPhotoOptions) return;
  selectedModelKey = modelKey;

  const chosen = coverPhotoOptions[modelKey];
  if (chosen) {
    coverPhotoURL = chosen.url;
    const childImg = document.querySelector('.cover-child-img');
    if (childImg) {
      childImg.src = chosen.url;
      applyCoverManualOffset(childImg);
      const layout = document.querySelector('.cover-layout');
      if (layout) layout.remove();
    } else {
      renderCarousel();
    }
  }
  // Model not loaded yet — keep current photo, just update selectedModelKey
  // Update toggle active state + slide indicator
  document.querySelectorAll('.model-toggle-option').forEach(el => {
    el.classList.toggle('active', el.dataset.model === modelKey);
  });
  const activeOpt = document.querySelector('.model-toggle-large .model-toggle-option.active');
  const indicator = document.querySelector('.model-toggle-indicator');
  if (activeOpt && indicator) {
    const idx = parseInt(activeOpt.dataset.idx) || 0;
    indicator.style.transform = `translateX(${idx * 46}px)`;
  }
  saveGlobalsToActiveCandidate();
  renderCoverControls();
}

function toggleRemoveBg(enabled) {
  useRemoveBg = enabled;
  localStorage.setItem('bookPreview_useRemoveBg', enabled);

  const toggleEl = document.getElementById('removebg-toggle');
  if (toggleEl) toggleEl.classList.toggle('active', enabled);

  if (enabled && coverPhotoOptions && !coverPhotoOptions['removebg'] && coverCroppedFile) {
    const fd = new FormData();
    fd.append('file', coverCroppedFile);
    fetch(`${SMART_CROP_API}/remove-bg?model=removebg`, { method: 'POST', body: fd })
      .then(async (resp) => {
        if (!resp.ok) return;
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const opt = { url };
        coverPhotoOptions['removebg'] = opt;
        renderCarousel();
      })
      .catch(e => console.warn('removebg 실패:', e));
  }

  if (!enabled && selectedModelKey === 'removebg') {
    const fallback = coverPhotoOptions && (coverPhotoOptions['portrait'] || coverPhotoOptions['ben2'] || coverPhotoOptions['hr-matting']);
    if (fallback) {
      const fallbackKey = coverPhotoOptions['portrait'] ? 'portrait' : coverPhotoOptions['ben2'] ? 'ben2' : 'hr-matting';
      selectCoverModel(fallbackKey);
    }
  }

  renderCarousel();
}

function startCoverPositionEdit() {
  isEditingCoverPos = true;
  if (!coverManualOffset) coverManualOffset = { dx: 0, dy: 0, rotation: 0 };

  const childImg = document.querySelector('.cover-child-img');
  if (!childImg) return;

  const wrap = childImg.closest('.slide-img-wrap');
  if (!wrap) return;

  // Replace cover controls with position edit UI
  const controlsEl = els.coverControls;
  const savedControlsHTML = controlsEl ? controlsEl.innerHTML : '';

  if (controlsEl) {
    controlsEl.innerHTML = `
      <div class="cover-pos-hint">드래그하여 위치를 조정하세요</div>
      <div class="cover-pos-buttons">
        <button class="cover-pos-btn cover-pos-done">완료</button>
        <button class="cover-pos-btn cover-pos-reset">초기화</button>
      </div>`;
  }

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
    isEditingCoverPos = false;
    saveGlobalsToActiveCandidate();
    if (controlsEl) controlsEl.innerHTML = '';
    renderCoverControls();
  };

  wrap.addEventListener('mousedown', onStart);
  wrap.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);

  const doneBtn = controlsEl.querySelector('.cover-pos-done');
  const resetBtn = controlsEl.querySelector('.cover-pos-reset');
  if (doneBtn) doneBtn.addEventListener('click', cleanup);
  if (resetBtn) resetBtn.addEventListener('click', () => {
    coverManualOffset = { dx: 0, dy: 0, rotation: 0 };
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
  const rot = coverManualOffset.rotation || 0;
  childImg.style.cssText = `height:${pos.height.toFixed(1)}%;top:${(pos.top + ty).toFixed(1)}%;left:50%;transform:translateX(${tx.toFixed(1)}%) rotate(${rot}deg)`;
}

function setupCoverEvents() {
  const fileInput = document.getElementById('cover-photo-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleCoverPhotos(e.target.files);
    fileInput.value = '';
  });

  const removebgToggle = document.getElementById('removebg-toggle');
  if (removebgToggle) {
    if (useRemoveBg) removebgToggle.classList.add('active');
    removebgToggle.addEventListener('click', () => {
      toggleRemoveBg(!useRemoveBg);
    });
  }

  // Delegate clicks for cover controls (in bottom panel + carousel)
  document.addEventListener('click', (e) => {
    // Candidate thumbnail click
    const candidateThumb = e.target.closest('.candidate-thumb');
    if (candidateThumb) {
      const idx = parseInt(candidateThumb.dataset.candidateIndex);
      if (!isNaN(idx)) switchCandidate(idx);
      return;
    }
    // Add more photos
    if (e.target.closest('#cover-add-btn')) {
      fileInput.click();
      return;
    }
    const toggleOption = e.target.closest('.model-toggle-option');
    if (toggleOption) {
      const modelKey = toggleOption.dataset.model;
      if (modelKey) selectCoverModel(modelKey);
      return;
    }
    if (e.target.closest('#cover-upload-btn') || e.target.closest('#cover-upload-zone')) {
      fileInput.click();
      return;
    }
    // Clicking cover hint in carousel → switch to photo step
    if (e.target.closest('.cover-hint-text')) {
      setStep(0);
      return;
    }
  });
}

// ========== Event Handlers ==========

function setupEvents() {
  els.firstNameInput.addEventListener('input', () => { updateVariables(); renderCarousel(); });
  els.parentNamesInput.addEventListener('input', () => { updateVariables(); renderCarousel(); });

  els.versionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.versionBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentVersion = btn.dataset.version;
      const pages = getPages();
      if (currentPageIndex >= pages.length) currentPageIndex = pages.length - 1;
      renderCarousel();
      renderThumbnails();
    });
  });

  // Step bar navigation
  els.stepTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      setStep(parseInt(tab.dataset.step));
    });
  });

  // Story sheet close
  document.getElementById('story-sheet-done').addEventListener('click', closeStorySheet);
  document.getElementById('story-sheet-backdrop').addEventListener('click', closeStorySheet);

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') goPage(-1);
    else if (e.key === 'ArrowRight') goPage(1);
  });
}

// ========== Init ==========

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  setupEvents();
  setupCoverEvents();
  loadConfig();
  window.addEventListener('resize', () => {
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
