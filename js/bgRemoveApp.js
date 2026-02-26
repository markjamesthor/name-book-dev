/**
 * 배경 제거 프로토타입 - 앱 로직
 * 서버: Windows RTX /remove-bg
 */

const API_URL = PipelineCore.API_URL;

// ========== DOM ==========
const els = {
    uploadArea: document.getElementById('upload-area'),
    fileInput: document.getElementById('file-input'),
    fileName: document.getElementById('file-name'),
    errorMessage: document.getElementById('error-message'),
    resSlider: document.getElementById('resolution-slider'),
    resValue: document.getElementById('res-value'),
    originalPreview: document.getElementById('original-preview'),
    resultCanvas: document.getElementById('result-canvas'),
    compareSection: document.getElementById('compare-section'),
    bgqaBadge: document.getElementById('bgqa-badge'),
    processingInfo: document.getElementById('processing-info'),
    previewSection: document.getElementById('preview-section'),
    previewWhite: document.getElementById('preview-white'),
    previewGray: document.getElementById('preview-gray'),
    previewBlack: document.getElementById('preview-black'),
    downloadSection: document.getElementById('download-section'),
    downloadBtn: document.getElementById('download-btn'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingTime: document.getElementById('loading-time'),
    loadingText: document.querySelector('.loading-text'),
};

// ========== State ==========
let selectedFile = null;       // 원본 File 객체
let processedBlob = null;      // 서버 응답 WebP blob (알파 포함)
let resultImage = null;        // 디코딩된 Image 객체
let sam2CropBlob = null;       // SAM2 bbox+padding 크롭 Blob

// Object Selection state (공통)
let objSelImage = null;        // 원본 이미지 element
let objSelScale = 1;           // 이미지→캔버스 스케일
let objSelMaskData = null;     // 전체 크기 마스크 ImageData (alpha 채널)
let objSelSegResult = null;    // SAM2 결과 { image, cropX, cropY, score }
// Auto segment state
let objSelSegments = null;     // 서버 응답 segments 배열
let objSelLabelMap = null;     // ImageData (label map 디코딩)
let objSelHoveredIdx = 0;      // 현재 hover 중인 세그먼트 index
let objSelSelectedIdx = 0;     // 선택된 세그먼트 index

// ========== LocalStorage 설정 유지 ==========
const LS_KEY = 'bgremove-prefs';

function savePrefs() {
    const prefs = {
        model: document.querySelector('input[name="model"]:checked')?.value,
        resolution: els.resSlider.value,
        original: document.getElementById('original-check').checked,
        sam2: document.getElementById('sam2-check').checked,
        sam2Padding: document.getElementById('sam2-padding-slider').value,
        gdino: document.getElementById('gdino-check').checked,
        vitmatte: document.getElementById('vitmatte-check').checked,
        objSel: document.getElementById('objsel-check').checked,
        objSelMode: document.querySelector('input[name="objsel-mode"]:checked')?.value || 'click',
        objSelMinArea: document.getElementById('objsel-min-area').value,
        objSelMaxMasks: document.getElementById('objsel-max-masks').value,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
}

function loadPrefs() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);

        // Model
        if (p.model) {
            const radio = document.getElementById(`m-${p.model}`);
            if (radio) radio.checked = true;
        }
        // Resolution
        if (p.resolution) {
            els.resSlider.value = p.resolution;
            els.resValue.textContent = p.resolution + 'px';
        }
        // Original checkbox
        const origCheck = document.getElementById('original-check');
        if (p.original != null) {
            origCheck.checked = p.original;
            document.getElementById('resolution-control').classList.toggle('disabled', p.original);
        }
        // SAM2
        if (p.sam2 != null) document.getElementById('sam2-check').checked = p.sam2;
        // SAM2 Padding
        if (p.sam2Padding != null) {
            document.getElementById('sam2-padding-slider').value = p.sam2Padding;
            document.getElementById('sam2-padding-value').textContent = p.sam2Padding + '%';
        }
        // Grounding DINO
        if (p.gdino != null) document.getElementById('gdino-check').checked = p.gdino;
        // ViTMatte
        if (p.vitmatte != null) document.getElementById('vitmatte-check').checked = p.vitmatte;
        // Object Selection
        if (p.objSel != null) document.getElementById('objsel-check').checked = p.objSel;
        // Object Selection mode
        if (p.objSelMode) {
            const r = document.querySelector(`input[name="objsel-mode"][value="${p.objSelMode}"]`);
            if (r) r.checked = true;
        }
        // Object Selection auto params
        if (p.objSelMinArea != null) {
            document.getElementById('objsel-min-area').value = p.objSelMinArea;
            document.getElementById('objsel-min-area-val').textContent = p.objSelMinArea + '%';
        }
        if (p.objSelMaxMasks != null) {
            document.getElementById('objsel-max-masks').value = p.objSelMaxMasks;
        }
    } catch (_) { /* ignore corrupt data */ }
}

loadPrefs();

// ========== Upload ==========
els.uploadArea.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});

// Drag & Drop (upload area)
els.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.uploadArea.classList.add('dragover');
});
els.uploadArea.addEventListener('dragleave', () => {
    els.uploadArea.classList.remove('dragover');
});
els.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

// Drag & Drop (화면 전체)
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.uploadArea.classList.add('dragover');
});
document.addEventListener('dragleave', (e) => {
    // 브라우저 밖으로 나갈 때만 해제 (자식 요소 간 이동은 무시)
    if (e.relatedTarget === null) {
        els.uploadArea.classList.remove('dragover');
    }
});
document.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
    hideError();

    // HEIC/HEIF → 서버에서 JPEG 변환
    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')
        || file.type === 'image/heic' || file.type === 'image/heif';
    if (isHeic) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            const resp = await fetch(`${API_URL}/convert-heic`, { method: 'POST', body: formData });
            if (!resp.ok) throw new Error('변환 실패');
            const blob = await resp.blob();
            file = new File([blob], file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'), { type: 'image/jpeg' });
        } catch (err) {
            showError('HEIC 변환에 실패했습니다.');
            return;
        }
    }

    if (!file.type.startsWith('image/')) {
        showError('이미지 파일만 업로드할 수 있습니다.');
        return;
    }

    selectedFile = file;
    els.fileName.textContent = file.name;
    els.uploadArea.classList.add('has-file');

    // 원본 미리보기
    const url = URL.createObjectURL(file);
    els.originalPreview.src = url;

    // 이전 결과 초기화 후 자동 실행
    resetResults();
    if (document.getElementById('cp-check').checked) {
        renderCPChain();
        runCustomPipeline();
    } else {
        runRemoveBg();
    }
}

// ========== Resolution Slider ==========
const originalCheck = document.getElementById('original-check');
const resControl = document.getElementById('resolution-control');

els.resSlider.addEventListener('input', () => {
    els.resValue.textContent = els.resSlider.value + 'px';
    savePrefs();
});

originalCheck.addEventListener('change', () => {
    if (originalCheck.checked) {
        resControl.classList.add('disabled');
    } else {
        resControl.classList.remove('disabled');
    }
    savePrefs();
});

function getMaxSize() {
    return originalCheck.checked ? 9999 : parseInt(els.resSlider.value);
}

// ========== Model Optimal Resolution ==========
const OPTIMAL_RESOLUTION = {
    'portrait': 1024,
    'hr': 2048,
    'hr-matting': 2048,
    'dynamic': 1024,
    'rmbg2': 1024,
    'ben2': 1024,
    'removebg': 1440,  // API가 자체 처리
};

function applyOptimalResolution(model) {
    if (originalCheck.checked) return;  // 원본 모드면 무시
    const optimal = OPTIMAL_RESOLUTION[model] || 1024;
    els.resSlider.value = optimal;
    els.resValue.textContent = optimal + 'px';
}

// ========== Model Change ==========
document.querySelectorAll('input[name="model"]').forEach(radio => {
    radio.addEventListener('change', () => {
        applyOptimalResolution(radio.value);
        savePrefs();
        if (selectedFile) runRemoveBg();
    });
});

// ========== SAM2 Toggle ==========
const sam2Check = document.getElementById('sam2-check');
const sam2PaddingControl = document.getElementById('sam2-padding-control');
const sam2PaddingSlider = document.getElementById('sam2-padding-slider');
const sam2PaddingValue = document.getElementById('sam2-padding-value');
const sam2SubOptions = document.getElementById('sam2-sub-options');
const gdinoCheck = document.getElementById('gdino-check');
const vitmatteCheck = document.getElementById('vitmatte-check');

function updateSAM2SubVisibility() {
    const on = sam2Check.checked;
    sam2PaddingControl.classList.toggle('visible', on && !vitmatteCheck.checked);
    sam2SubOptions.classList.toggle('visible', on);
}
updateSAM2SubVisibility();

sam2Check.addEventListener('change', () => {
    updateSAM2SubVisibility();
    savePrefs();
    if (selectedFile) runRemoveBg();
});

gdinoCheck.addEventListener('change', () => {
    savePrefs();
    if (selectedFile && sam2Check.checked) runRemoveBg();
});

vitmatteCheck.addEventListener('change', () => {
    updateSAM2SubVisibility();
    savePrefs();
    if (selectedFile && sam2Check.checked) runRemoveBg();
});

// Object Selection toggle
document.getElementById('objsel-check').addEventListener('change', () => {
    updateObjSelSubVisibility();
    savePrefs();
    if (selectedFile && sam2Check.checked) runRemoveBg();
});

// Object Selection mode & params
document.querySelectorAll('input[name="objsel-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        updateObjSelAutoOptsVisibility();
        savePrefs();
    });
});
document.getElementById('objsel-min-area').addEventListener('input', () => {
    const v = document.getElementById('objsel-min-area').value;
    document.getElementById('objsel-min-area-val').textContent = v + '%';
    savePrefs();
});
document.getElementById('objsel-max-masks').addEventListener('change', () => {
    savePrefs();
});

function updateObjSelSubVisibility() {
    const checked = document.getElementById('objsel-check').checked;
    document.getElementById('objsel-sub-options').classList.toggle('visible', checked);
    if (checked) updateObjSelAutoOptsVisibility();
}
function updateObjSelAutoOptsVisibility() {
    const mode = document.querySelector('input[name="objsel-mode"]:checked')?.value;
    document.getElementById('objsel-auto-opts').classList.toggle('visible', mode === 'auto');
}
// 초기 상태
updateObjSelSubVisibility();

sam2PaddingSlider.addEventListener('input', () => {
    sam2PaddingValue.textContent = sam2PaddingSlider.value + '%';
    savePrefs();
});

sam2PaddingSlider.addEventListener('change', () => {
    if (selectedFile && sam2Check.checked) runRemoveBg();
});


// ========== Run ==========
async function runRemoveBg() {
    if (!selectedFile) return;

    const model = document.querySelector('input[name="model"]:checked').value;
    const maxSize = getMaxSize();
    const useSAM2 = document.getElementById('sam2-check').checked;

    // UI 상태
    showLoading();
    hideError();
    resetResults();

    const startTime = performance.now();
    let timerInterval = setInterval(() => {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        els.loadingTime.textContent = `${elapsed}초 경과`;
    }, 100);

    try {
        let fileToSend = selectedFile;

        // === SAM2 전처리 (2단계 파이프라인) ===
        const useGDINO = useSAM2 && gdinoCheck.checked;
        const useViTMatte = useSAM2 && vitmatteCheck.checked;
        let sam2MaskBlob = null;  // ViTMatte에서 사용할 SAM2 마스크

        if (useSAM2 && document.getElementById('objsel-check').checked) {
            const img = await blobToImage(selectedFile);
            await runObjectSelection(img);
            hideLoading();
            clearInterval(timerInterval);
            return;
        }

        if (useSAM2) {
            const pipeline = document.getElementById('sam2-pipeline');
            pipeline.classList.add('visible');
            // ViTMatte ON → 6-step grid; OFF → 4-step grid
            const grid = pipeline.querySelector('.pipeline-grid');
            const resultNum = document.getElementById('pipe-result-num');
            if (useViTMatte) {
                grid.classList.add('six-steps');
                if (resultNum) resultNum.textContent = '6';
            } else {
                grid.classList.remove('six-steps');
                if (resultNum) resultNum.textContent = '4';
            }
            const img = await blobToImage(selectedFile);

            let childFace, adultFaces = [], dinoBbox = null;

            if (useGDINO) {
                // === Grounding DINO로 아이 감지 ===
                setPipeStep('face', 'active', 'DINO 로딩...');
                els.loadingText.textContent = 'Grounding DINO 감지 중...';

                const dinoFormData = new FormData();
                dinoFormData.append('file', selectedFile);

                const dinoStart = performance.now();
                const dinoResp = await fetch(`${API_URL}/detect-child`, { method: 'POST', body: dinoFormData });
                const dinoTime = ((performance.now() - dinoStart) / 1000).toFixed(2);

                if (!dinoResp.ok) {
                    const errData = await dinoResp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `DINO 서버 오류 (${dinoResp.status})`));
                }

                const dinoResult = await dinoResp.json();
                const dinoBoxes = dinoResult.detections || [];

                const faceCanvas = document.getElementById('pipe-face-canvas');

                if (dinoBoxes.length < 1) throw new Error('Grounding DINO: 아이가 감지되지 않았습니다.');

                // 가장 작은 person = 아이 (면적 기준)
                const sorted = [...dinoBoxes].sort((a, b) => {
                    const areaA = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
                    const areaB = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
                    return areaA - areaB;
                });
                const childBox = sorted[0];
                drawDinoBoxes(faceCanvas, img, dinoBoxes, childBox);
                setPipeStep('face', 'done', `${dinoTime}초 (DINO)`);
                dinoBbox = childBox.box; // [x1, y1, x2, y2]

                const imgArea = img.width * img.height;
                const dinoDetails = sorted.map((d, i) => {
                    const w = d.box[2] - d.box[0], h = d.box[3] - d.box[1];
                    const pct = (w * h / imgArea * 100).toFixed(1);
                    const role = i === 0 ? '아이' : `어른${sorted.length > 2 ? ' ' + i : ''}`;
                    return `${role}: ${w.toFixed(0)}x${h.toFixed(0)} (${pct}%) [${(d.score * 100).toFixed(0)}%]`;
                });
                setPipeInfo('face', dinoDetails.join(' | '));

                // DINO에서 얻은 bbox 중심을 point prompt에도 사용
                childFace = {
                    cx: (dinoBbox[0] + dinoBbox[2]) / 2,
                    cy: (dinoBbox[1] + dinoBbox[3]) / 2,
                    x: dinoBbox[0], y: dinoBbox[1],
                    width: dinoBbox[2] - dinoBbox[0],
                    height: dinoBbox[3] - dinoBbox[1],
                };
                // 어른 = 나머지 큰 boxes
                adultFaces = sorted.slice(1).map(d => ({
                    cx: (d.box[0] + d.box[2]) / 2,
                    cy: (d.box[1] + d.box[3]) / 2,
                    x: d.box[0], y: d.box[1],
                    width: d.box[2] - d.box[0],
                    height: d.box[3] - d.box[1],
                }));

                // Step 2: Box Prompt 시각화
                setPipeStep('points', 'active', 'Box prompt...');
                const pointsCanvas = document.getElementById('pipe-points-canvas');
                drawBoxPrompt(pointsCanvas, img, dinoBbox, adultFaces);
                setPipeStep('points', 'done');
                setPipeInfo('points', `Box: [${dinoBbox.map(v => v.toFixed(0)).join(', ')}]` +
                    (adultFaces.length > 0 ? ` | neg: ${adultFaces.length}명` : ''));
            } else {
                // === face-api.js로 얼굴 감지 (기존 방식) ===
                setPipeStep('face', 'active', '로딩...');
                els.loadingText.textContent = '얼굴 감지 중...';

                const loaded = await loadFaceApi();
                if (!loaded) throw new Error('face-api.js 로드 실패 — WebGL이 필요합니다.');

                setPipeStep('face', 'active', '감지 중...');
                const faceStart = performance.now();
                const faces = await detectFacesInImage(img);
                const faceTime = ((performance.now() - faceStart) / 1000).toFixed(2);

                const faceCanvas = document.getElementById('pipe-face-canvas');
                drawFaceBoxes(faceCanvas, img, faces);
                setPipeStep('face', 'done', `${faceTime}초`);

                const imgArea = img.width * img.height;
                const faceDetails = faces.map((f, i) => {
                    const pct = (f.area / imgArea * 100).toFixed(1);
                    const role = (faces.length === 1) ? '대상' : (i === faces.length - 1 ? '아이' : '어른');
                    return `${role}: ${f.width.toFixed(0)}x${f.height.toFixed(0)} (${pct}%)`;
                });
                setPipeInfo('face', faces.length > 0 ? faceDetails.join(' | ') : '감지된 얼굴 없음');

                if (faces.length < 1) throw new Error('얼굴이 감지되지 않았습니다.');

                childFace = faces[faces.length - 1];
                adultFaces = faces.length > 1 ? faces.slice(0, -1) : [];

                // Step 2: Point Prompts
                setPipeStep('points', 'active', '설정 중...');
                const pointsCanvas = document.getElementById('pipe-points-canvas');
                drawPointPrompts(pointsCanvas, img, childFace, adultFaces);
                setPipeStep('points', 'done');

                const posLabel = `+ (${childFace.cx.toFixed(0)}, ${childFace.cy.toFixed(0)})`;
                const negLabels = adultFaces.map(f => `- (${f.cx.toFixed(0)}, ${f.cy.toFixed(0)})`).join(' ');
                setPipeInfo('points', `${posLabel} ${negLabels}`.trim());
            }

            // Step 3: SAM2 Segmentation
            setPipeStep('mask', 'active', '서버 처리 중...');
            els.loadingText.textContent = 'SAM2 세그멘테이션 중...';

            const sam2FormData = new FormData();
            sam2FormData.append('file', selectedFile);
            sam2FormData.append('point_x', childFace.cx.toString());
            sam2FormData.append('point_y', childFace.cy.toString());
            if (adultFaces.length > 0) {
                sam2FormData.append('neg_points', JSON.stringify(adultFaces.map(f => [f.cx, f.cy])));
            }
            // DINO box prompt
            if (dinoBbox) {
                sam2FormData.append('box', JSON.stringify(dinoBbox));
            }

            const sam2Start = performance.now();
            const sam2Resp = await fetch(`${API_URL}/segment-child`, { method: 'POST', body: sam2FormData });
            const sam2Time = ((performance.now() - sam2Start) / 1000).toFixed(2);

            if (!sam2Resp.ok) {
                const errData = await sam2Resp.json().catch(() => null);
                throw new Error(extractErrorDetail(errData, `SAM2 서버 오류 (${sam2Resp.status})`));
            }

            const sam2Score = sam2Resp.headers.get('X-SAM2-Score') || '?';
            const sam2CropX = parseInt(sam2Resp.headers.get('X-Crop-X') || '0');
            const sam2CropY = parseInt(sam2Resp.headers.get('X-Crop-Y') || '0');
            const sam2CropW = parseInt(sam2Resp.headers.get('X-Crop-Width') || '0');
            const sam2CropH = parseInt(sam2Resp.headers.get('X-Crop-Height') || '0');

            const sam2Blob = await sam2Resp.blob();
            const sam2Image = await blobToImage(sam2Blob);
            sam2MaskBlob = sam2Blob;  // ViTMatte에서 사용

            const maskCanvas = document.getElementById('pipe-mask-canvas');
            drawMaskOverlay(maskCanvas, img, sam2Image, sam2CropX, sam2CropY);
            setPipeStep('mask', 'done', `${sam2Time}초`);
            setPipeInfo('mask', `Score: ${sam2Score} | 크롭: ${sam2CropW}x${sam2CropH}` +
                (dinoBbox ? ' (box prompt)' : ' (point prompt)'));

            if (useViTMatte) {
                // === Step 4: Trimap 시각화 ===
                setPipeStep('trimap', 'active', '생성 중...');

                // SAM2 결과(크롭된 RGBA)를 원본 크기 그레이스케일 마스크로 복원
                const fullMaskCanvas = document.createElement('canvas');
                fullMaskCanvas.width = img.width;
                fullMaskCanvas.height = img.height;
                const mCtx = fullMaskCanvas.getContext('2d');
                mCtx.clearRect(0, 0, img.width, img.height);
                mCtx.drawImage(sam2Image, sam2CropX, sam2CropY);
                // 알파 채널만 추출하여 그레이스케일 마스크 생성
                const imgData = mCtx.getImageData(0, 0, img.width, img.height);
                const pixels = imgData.data;
                for (let i = 0; i < pixels.length; i += 4) {
                    const a = pixels[i + 3]; // alpha
                    pixels[i] = a;     // R = alpha
                    pixels[i + 1] = a; // G = alpha
                    pixels[i + 2] = a; // B = alpha
                    pixels[i + 3] = 255;
                }
                mCtx.putImageData(imgData, 0, 0);

                // Trimap 시각화
                const trimapCanvas = document.getElementById('pipe-trimap-canvas');
                const trimapStats = drawTrimapVisualization(trimapCanvas, fullMaskCanvas, img);
                setPipeStep('trimap', 'done');
                setPipeInfo('trimap', `FG ${trimapStats.fg}% · Unknown ${trimapStats.unk}% · BG ${trimapStats.bg}%`);

                // === Step 5: ViTMatte 알파 매팅 ===
                setPipeStep('alpha', 'active', 'ViTMatte 처리 중...');
                setPipeStep('result', 'active', '대기 중...');
                els.loadingText.textContent = 'ViTMatte 정밀 매팅 중...';

                const maskBlob = await new Promise((resolve, reject) => {
                    fullMaskCanvas.toBlob(b => b ? resolve(b) : reject(new Error('마스크 생성 실패')), 'image/png');
                });

                const vitFormData = new FormData();
                vitFormData.append('file', selectedFile);
                vitFormData.append('mask', new File([maskBlob], 'mask.png', { type: 'image/png' }));

                const vitStart = performance.now();
                const vitResp = await fetch(`${API_URL}/vitmatte`, { method: 'POST', body: vitFormData });
                const vitTime = ((performance.now() - vitStart) / 1000).toFixed(2);

                if (!vitResp.ok) {
                    const errData = await vitResp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `ViTMatte 서버 오류 (${vitResp.status})`));
                }

                processedBlob = await vitResp.blob();
                resultImage = await blobToImage(processedBlob);

                // Alpha Matte 시각화
                const alphaCanvas = document.getElementById('pipe-alpha-canvas');
                drawAlphaMatte(alphaCanvas, resultImage);
                setPipeStep('alpha', 'done', `${vitTime}초`);
                setPipeInfo('alpha', '경계 반투명 처리');

                // === Step 6: 최종 결과 ===
                const totalElapsed = ((performance.now() - startTime) / 1000).toFixed(2);
                const resultPipeCanvas = document.getElementById('pipe-result-canvas');
                drawSAM2Result(resultPipeCanvas, resultImage);
                setPipeStep('result', 'done', `${totalElapsed}초`);
                setPipeInfo('result', `${resultImage.width}x${resultImage.height} · 전체 ${totalElapsed}초`);

                // ViTMatte 크롭도 다운로드 가능하게
                sam2CropBlob = sam2MaskBlob;
                document.getElementById('download-crop-btn').style.display = '';
            } else {
                // === bbox + padding 크롭 → bg-removal 모델 (기존 방식) ===
                els.loadingText.textContent = '아이 영역 크롭 중...';
                const padPct = parseInt(sam2PaddingSlider.value) / 100;
                const padW = Math.round(sam2CropW * padPct);
                const padH = Math.round(sam2CropH * padPct);
                const cropX = Math.max(0, sam2CropX - padW);
                const cropY = Math.max(0, sam2CropY - padH);
                const cropR = Math.min(img.width, sam2CropX + sam2CropW + padW);
                const cropB = Math.min(img.height, sam2CropY + sam2CropH + padH);
                const finalCropW = cropR - cropX;
                const finalCropH = cropB - cropY;

                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = finalCropW;
                cropCanvas.height = finalCropH;
                const cropCtx = cropCanvas.getContext('2d');
                cropCtx.drawImage(img, cropX, cropY, finalCropW, finalCropH, 0, 0, finalCropW, finalCropH);

                sam2CropBlob = await new Promise((resolve, reject) => {
                    cropCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('SAM2 크롭 실패')), 'image/jpeg', 0.85);
                });

                fileToSend = new File([sam2CropBlob], 'sam2_crop.jpg', { type: 'image/jpeg' });
                document.getElementById('download-crop-btn').style.display = '';

                // Step 4 시작 전 상태 업데이트
                setPipeStep('result', 'active', '배경 제거 중...');
            }
        }

        // === ViTMatte를 사용한 경우 bg-removal 건너뛰기 ===
        if (useViTMatte) {
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

            // 결과 렌더링
            renderResult(resultImage);
            renderPreviews(resultImage);

            // ViTMatte는 BGQA 없음 → 빈 badge
            els.bgqaBadge.classList.remove('visible');

            const pipelineDesc = [useGDINO ? 'DINO' : 'face-api', 'SAM2', 'ViTMatte'].join(' → ');
            els.processingInfo.textContent =
                `${pipelineDesc} | ${resultImage.width}x${resultImage.height} | 전체: ${elapsed}초`;
            els.processingInfo.classList.add('visible');

            els.compareSection.classList.add('visible');
            els.previewSection.classList.add('visible');
            els.downloadSection.classList.add('visible');
        } else {
            // === 배경 제거 모델 실행 ===
            els.loadingText.textContent = '배경을 제거하고 있습니다...';

            const formData = new FormData();
            formData.append('file', fileToSend);

            const url = `${API_URL}/remove-bg?max_size=${maxSize}&model=${model}`;
            const resp = await fetch(url, { method: 'POST', body: formData });

            if (!resp.ok) {
                const errData = await resp.json().catch(() => null);
                throw new Error(extractErrorDetail(errData, `서버 오류 (${resp.status})`));
            }

            // 헤더에서 메타데이터 추출
            const headers = {
                originalWidth: resp.headers.get('X-Original-Width'),
                originalHeight: resp.headers.get('X-Original-Height'),
                cropX: resp.headers.get('X-Crop-X'),
                cropY: resp.headers.get('X-Crop-Y'),
                cropWidth: resp.headers.get('X-Crop-Width'),
                cropHeight: resp.headers.get('X-Crop-Height'),
                bgqaScore: parseFloat(resp.headers.get('X-BGQA-Score') || '0'),
                bgqaPassed: resp.headers.get('X-BGQA-Passed') === 'true',
                bgqaIssues: resp.headers.get('X-BGQA-Issues') || '',
                bgqaCaseType: resp.headers.get('X-BGQA-CaseType') || '',
            };

            processedBlob = await resp.blob();
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

            // 이미지 디코딩
            resultImage = await blobToImage(processedBlob);

            // SAM2 ON: Step 4 완료 + pipeline result 렌더링
            if (useSAM2) {
                const resultPipeCanvas = document.getElementById('pipe-result-canvas');
                drawSAM2Result(resultPipeCanvas, resultImage);
                setPipeStep('result', 'done');
                setPipeInfo('result', `${resultImage.width}x${resultImage.height} | ${model}`);
            }

            // 결과 렌더링
            renderResult(resultImage);
            renderPreviews(resultImage);
            showBgqaBadge(headers);

            if (useSAM2) {
                const pipelineDesc = useGDINO ? 'DINO → SAM2' : 'face-api → SAM2';
                els.processingInfo.textContent =
                    `${pipelineDesc} + ${model} | BGQA: ${headers.bgqaScore.toFixed(1)}점 | 해상도: ${maxSize}px | 전체: ${elapsed}초`;
                els.processingInfo.classList.add('visible');
            } else {
                showProcessingInfo(model, maxSize, elapsed, headers);
            }

            els.compareSection.classList.add('visible');
            els.previewSection.classList.add('visible');
            els.downloadSection.classList.add('visible');
        }

    } catch (err) {
        showError(err.message || String(err));
        // SAM2 크롭은 성공했으면 다운로드 가능하게
        if (sam2CropBlob) {
            els.downloadSection.classList.add('visible');
        }
    } finally {
        clearInterval(timerInterval);
        hideLoading();
    }
}

// ========== Render ==========
function renderResult(img) {
    const canvas = els.resultCanvas;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
}

function renderPreviews(img) {
    const configs = [
        { canvas: els.previewWhite, color: '#ffffff' },
        { canvas: els.previewGray, color: '#808080' },
        { canvas: els.previewBlack, color: '#000000' },
    ];

    for (const { canvas, color } of configs) {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    }
}

function showBgqaBadge(headers) {
    const badge = els.bgqaBadge;
    const score = headers.bgqaScore;
    const passed = headers.bgqaPassed;
    const issues = headers.bgqaIssues;

    let text = `BGQA ${score.toFixed(1)}점`;
    if (passed) {
        text += ' — PASS';
        badge.className = 'bgqa-badge visible pass';
    } else {
        text += ' — FAIL';
        if (issues) text += ` (${issues})`;
        badge.className = 'bgqa-badge visible fail';
    }
    badge.textContent = text;
}

function showProcessingInfo(model, maxSize, elapsed, headers) {
    const info = [];
    info.push(`모델: ${model}`);
    info.push(`해상도: ${maxSize}px`);
    info.push(`처리시간: ${elapsed}초`);
    if (headers.originalWidth) {
        info.push(`원본: ${headers.originalWidth}x${headers.originalHeight}`);
    }
    if (headers.cropWidth) {
        info.push(`크롭: ${headers.cropWidth}x${headers.cropHeight}`);
    }
    els.processingInfo.textContent = info.join('  |  ');
    els.processingInfo.classList.add('visible');
}

// ========== Download ==========
els.downloadBtn.addEventListener('click', () => {
    if (!resultImage) return;

    // Canvas를 PNG로 변환
    const canvas = document.createElement('canvas');
    canvas.width = resultImage.width;
    canvas.height = resultImage.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(resultImage, 0, 0);

    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const baseName = selectedFile ? selectedFile.name.replace(/\.[^.]+$/, '') : 'result';
        a.download = `${baseName}_nobg.png`;
        a.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
});

// SAM2 크롭 다운로드
document.getElementById('download-crop-btn').addEventListener('click', () => {
    if (!sam2CropBlob) return;
    const url = URL.createObjectURL(sam2CropBlob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = selectedFile ? selectedFile.name.replace(/\.[^.]+$/, '') : 'result';
    a.download = `${baseName}_sam2crop.jpg`;
    a.click();
    URL.revokeObjectURL(url);
});

// ========== Helpers ==========
const blobToImage = PipelineCore.blobToImage;

function showLoading() { els.loadingOverlay.classList.add('visible'); }
function hideLoading() { els.loadingOverlay.classList.remove('visible'); }

function showError(msg) {
    if (typeof msg !== 'string') msg = msg?.message || JSON.stringify(msg) || '알 수 없는 오류';
    els.errorMessage.textContent = msg;
    els.errorMessage.classList.add('visible');
}

const extractErrorDetail = PipelineCore.extractErrorDetail;

function hideError() {
    els.errorMessage.classList.remove('visible');
}

function resetResults() {
    processedBlob = null;
    resultImage = null;
    sam2CropBlob = null;
    els.compareSection.classList.remove('visible');
    els.previewSection.classList.remove('visible');
    els.downloadSection.classList.remove('visible');
    els.bgqaBadge.classList.remove('visible');
    els.processingInfo.classList.remove('visible');
    document.getElementById('download-crop-btn').style.display = 'none';
    resetSAM2Pipeline();
    // Object Selection 정리
    resetObjectSelection();
}

// ========== SAM2 Pipeline ==========

const loadFaceApi = PipelineCore.loadFaceApi;
const detectFacesInImage = PipelineCore.detectFacesInImage;

// --- Pipeline step helpers ---

function setPipeStep(name, state, statusText) {
    const card = document.getElementById(`pipe-${name}`);
    if (!card) return;
    card.classList.remove('active', 'done');
    if (state) card.classList.add(state);
    const el = document.getElementById(`pipe-${name}-status`);
    if (el) el.textContent = statusText || '';
}

function setPipeInfo(name, text) {
    const el = document.getElementById(`pipe-${name}-info`);
    if (el) el.textContent = text || '';
}

function resetSAM2Pipeline() {
    const pipeline = document.getElementById('sam2-pipeline');
    if (pipeline) {
        pipeline.classList.remove('visible');
        const grid = pipeline.querySelector('.pipeline-grid');
        if (grid) {
            grid.classList.remove('six-steps');
            grid.style.gridTemplateColumns = '';
        }
        const titleEl = pipeline.querySelector('.pipeline-title');
        if (titleEl) titleEl.textContent = 'SAM2 세그멘테이션 파이프라인';
    }
    for (const step of ['face', 'points', 'mask', 'trimap', 'alpha', 'result']) {
        setPipeStep(step, null, '');
        setPipeInfo(step, '');
        const c = document.getElementById(`pipe-${step}-canvas`);
        if (c) { c.width = 0; c.height = 0; }
    }
    // Reset step numbers
    const resultNum = document.getElementById('pipe-result-num');
    if (resultNum) resultNum.textContent = '4';
}

// --- Pipeline drawing ---

function drawScaled(canvas, img, maxW = 500, maxH = 280) {
    const scale = Math.min(1, maxW / img.width, maxH / img.height);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { ctx, scale };
}

function drawFaceBoxes(canvas, img, faces) {
    const { ctx, scale } = drawScaled(canvas, img);

    for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        const isChild = (faces.length === 1) || (i === faces.length - 1);

        // Box
        ctx.strokeStyle = isChild ? '#4caf50' : '#f44336';
        ctx.lineWidth = 2;
        ctx.strokeRect(f.x * scale, f.y * scale, f.width * scale, f.height * scale);

        // Label background + text
        const label = faces.length === 1
            ? `얼굴 (${(f.score * 100).toFixed(0)}%)`
            : isChild
                ? `아이 (${(f.score * 100).toFixed(0)}%)`
                : `어른${faces.length > 2 ? ' ' + (i + 1) : ''} (${(f.score * 100).toFixed(0)}%)`;
        const fontSize = Math.max(11, Math.round(14 * scale));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const tw = ctx.measureText(label).width;
        const lh = fontSize + 6;
        const ly = f.y * scale - lh;
        ctx.fillStyle = isChild ? 'rgba(76,175,80,0.85)' : 'rgba(244,67,54,0.85)';
        ctx.fillRect(f.x * scale, Math.max(0, ly), tw + 8, lh);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, f.x * scale + 4, Math.max(fontSize, ly + fontSize));
    }
}

function drawPointPrompts(canvas, img, childFace, adultFaces) {
    const { ctx, scale } = drawScaled(canvas, img);
    const r = Math.max(8, Math.min(canvas.width, canvas.height) * 0.025);

    // Negative points (adults) — red with minus
    for (const f of adultFaces) {
        const x = f.cx * scale, y = f.cy * scale;
        ctx.fillStyle = 'rgba(244, 67, 54, 0.9)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y); ctx.stroke();
    }

    // Positive point (child) — green with plus
    const cx = childFace.cx * scale, cy = childFace.cy * scale;
    ctx.fillStyle = 'rgba(76, 175, 80, 0.9)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.5, cy); ctx.lineTo(cx + r * 0.5, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.5); ctx.lineTo(cx, cy + r * 0.5); ctx.stroke();

    // Legend
    const fontSize = Math.max(10, Math.round(12 * scale));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const lx = 8, ly = canvas.height - (adultFaces.length > 0 ? fontSize * 2 + 10 : fontSize + 8);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(lx - 4, ly - 4, 180 * scale, adultFaces.length > 0 ? fontSize * 2 + 12 : fontSize + 10);
    ctx.fillStyle = '#4caf50';
    ctx.fillText('+ foreground (아이)', lx, ly + fontSize);
    if (adultFaces.length > 0) {
        ctx.fillStyle = '#f44336';
        ctx.fillText('- background (어른)', lx, ly + fontSize * 2 + 4);
    }
}

function drawMaskOverlay(canvas, originalImg, resultImg, cropX, cropY) {
    const maxW = 500, maxH = 280;
    const scale = Math.min(1, maxW / originalImg.width, maxH / originalImg.height);
    canvas.width = Math.round(originalImg.width * scale);
    canvas.height = Math.round(originalImg.height * scale);
    const ctx = canvas.getContext('2d');

    // 1. Dimmed original
    ctx.drawImage(originalImg, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Bright original masked to SAM2 area
    const bright = document.createElement('canvas');
    bright.width = canvas.width;
    bright.height = canvas.height;
    const bCtx = bright.getContext('2d');
    bCtx.drawImage(originalImg, 0, 0, canvas.width, canvas.height);
    bCtx.globalCompositeOperation = 'destination-in';
    bCtx.drawImage(resultImg,
        cropX * scale, cropY * scale,
        resultImg.width * scale, resultImg.height * scale);
    ctx.drawImage(bright, 0, 0);

    // 3. Green tint on mask area
    const tint = document.createElement('canvas');
    tint.width = canvas.width;
    tint.height = canvas.height;
    const tCtx = tint.getContext('2d');
    tCtx.fillStyle = 'rgba(76, 175, 80, 0.15)';
    tCtx.fillRect(0, 0, tint.width, tint.height);
    tCtx.globalCompositeOperation = 'destination-in';
    tCtx.drawImage(resultImg,
        cropX * scale, cropY * scale,
        resultImg.width * scale, resultImg.height * scale);
    ctx.drawImage(tint, 0, 0);
}

function drawSAM2Result(canvas, resultImg) {
    drawScaled(canvas, resultImg);
}

function drawTrimapVisualization(canvas, maskCanvas, origImg) {
    const maxW = 500, maxH = 280;
    const scale = Math.min(1, maxW / origImg.width, maxH / origImg.height);
    canvas.width = Math.round(origImg.width * scale);
    canvas.height = Math.round(origImg.height * scale);
    const ctx = canvas.getContext('2d');

    // Draw original dimmed
    ctx.drawImage(origImg, 0, 0, canvas.width, canvas.height);

    // Read mask data at display scale
    const tmpC = document.createElement('canvas');
    tmpC.width = canvas.width; tmpC.height = canvas.height;
    const tmpCtx = tmpC.getContext('2d');
    tmpCtx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
    const maskData = tmpCtx.getImageData(0, 0, canvas.width, canvas.height).data;

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = imgData.data;
    let fgCount = 0, unkCount = 0, bgCount = 0;
    const total = canvas.width * canvas.height;

    for (let i = 0; i < px.length; i += 4) {
        const a = maskData[i]; // grayscale mask value (R channel)
        if (a > 200) {
            // Foreground — green overlay
            px[i]   = Math.round(px[i] * 0.3 + 76 * 0.7);
            px[i+1] = Math.round(px[i+1] * 0.3 + 175 * 0.7);
            px[i+2] = Math.round(px[i+2] * 0.3 + 80 * 0.7);
            fgCount++;
        } else if (a > 30) {
            // Unknown — yellow overlay
            px[i]   = Math.round(px[i] * 0.2 + 255 * 0.8);
            px[i+1] = Math.round(px[i+1] * 0.2 + 235 * 0.8);
            px[i+2] = Math.round(px[i+2] * 0.2 + 59 * 0.8);
            unkCount++;
        } else {
            // Background — darken
            px[i]   = Math.round(px[i] * 0.4);
            px[i+1] = Math.round(px[i+1] * 0.4);
            px[i+2] = Math.round(px[i+2] * 0.4);
            bgCount++;
        }
    }
    ctx.putImageData(imgData, 0, 0);

    // Legend overlay
    const legendDiv = canvas.parentElement.querySelector('.trimap-legend');
    if (!legendDiv) {
        const leg = document.createElement('div');
        leg.className = 'trimap-legend';
        leg.innerHTML = '<span class="tl-fg">전경</span><span class="tl-unk">경계</span><span class="tl-bg">배경</span>';
        canvas.parentElement.appendChild(leg);
    }

    return {
        fg: (fgCount / total * 100).toFixed(0),
        unk: (unkCount / total * 100).toFixed(0),
        bg: (bgCount / total * 100).toFixed(0),
    };
}

function drawAlphaMatte(canvas, vitmatteImg) {
    const { ctx } = drawScaled(canvas, vitmatteImg);
    // Extract alpha channel as grayscale
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = imgData.data;
    for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        px[i] = a; px[i+1] = a; px[i+2] = a; px[i+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
}

// --- Grounding DINO 시각화 ---

// COCO 17 skeleton connections: [from, to]
const COCO_SKELETON = [
    [0, 1], [0, 2], [1, 3], [2, 4],         // head
    [5, 6],                                    // shoulders
    [5, 7], [7, 9],                            // left arm
    [6, 8], [8, 10],                           // right arm
    [5, 11], [6, 12],                          // torso
    [11, 12],                                  // hips
    [11, 13], [13, 15],                        // left leg
    [12, 14], [14, 16],                        // right leg
];

function drawPoseKeypoints(canvas, img, persons, minScore = 0.3) {
    const { ctx, scale } = drawScaled(canvas, img);

    for (let pIdx = 0; pIdx < persons.length; pIdx++) {
        const person = persons[pIdx];
        const isChild = pIdx === 0;
        const color = isChild ? '#4caf50' : '#f44336';
        const dimColor = isChild ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)';

        // Draw skeleton lines
        for (const [from, to] of COCO_SKELETON) {
            if (from >= person.keypoints.length || to >= person.keypoints.length) continue;
            const fromScore = person.scores[from];
            const toScore = person.scores[to];
            const valid = fromScore > minScore && toScore > minScore;

            const [fx, fy] = person.keypoints[from];
            const [tx, ty] = person.keypoints[to];

            ctx.strokeStyle = valid ? color : dimColor;
            ctx.lineWidth = valid ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(fx * scale, fy * scale);
            ctx.lineTo(tx * scale, ty * scale);
            ctx.stroke();
        }

        // Draw keypoints
        const r = Math.max(3, Math.min(canvas.width, canvas.height) * 0.012);
        for (let i = 0; i < person.keypoints.length; i++) {
            const [x, y] = person.keypoints[i];
            const score = person.scores[i];
            const valid = score > minScore;

            ctx.fillStyle = valid ? color : dimColor;
            ctx.beginPath();
            ctx.arc(x * scale, y * scale, valid ? r : r * 0.6, 0, Math.PI * 2);
            ctx.fill();

            if (valid) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x * scale, y * scale, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Label
        if (person.bbox) {
            const [bx1, by1] = person.bbox;
            const label = isChild ? 'child' : `adult ${pIdx}`;
            const validCount = person.scores.filter(s => s > minScore).length;
            const text = `${label} (${validCount}/17)`;
            const fontSize = Math.max(10, Math.round(12 * scale));
            ctx.font = `bold ${fontSize}px sans-serif`;
            const tw = ctx.measureText(text).width;
            ctx.fillStyle = isChild ? 'rgba(76,175,80,0.85)' : 'rgba(244,67,54,0.85)';
            ctx.fillRect(bx1 * scale, Math.max(0, by1 * scale - fontSize - 6), tw + 8, fontSize + 6);
            ctx.fillStyle = '#fff';
            ctx.fillText(text, bx1 * scale + 4, Math.max(fontSize, by1 * scale - 3));
        }
    }
}

function drawDinoBoxes(canvas, img, detections, selectedDetection) {
    const { ctx, scale } = drawScaled(canvas, img);

    // 면적 기준 정렬 (큰 것 먼저 → 선택된 것이 마지막에 위에 표시)
    const sorted = [...detections].sort((a, b) => {
        const aArea = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
        const bArea = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
        return bArea - aArea;
    });

    // selectedDetection이 있으면 맨 마지막에 그리도록 재정렬
    if (selectedDetection) {
        const selIdx = sorted.findIndex(d =>
            d.box[0] === selectedDetection.box[0] && d.box[1] === selectedDetection.box[1] &&
            d.box[2] === selectedDetection.box[2] && d.box[3] === selectedDetection.box[3]);
        if (selIdx >= 0) {
            const [sel] = sorted.splice(selIdx, 1);
            sorted.push(sel);
        }
    }

    for (let i = 0; i < sorted.length; i++) {
        const d = sorted[i];
        const isTarget = selectedDetection
            ? (d.box[0] === selectedDetection.box[0] && d.box[1] === selectedDetection.box[1] &&
               d.box[2] === selectedDetection.box[2] && d.box[3] === selectedDetection.box[3])
            : i === sorted.length - 1; // fallback: 가장 작은 것
        const [x1, y1, x2, y2] = d.box;

        ctx.strokeStyle = isTarget ? '#4caf50' : '#f44336';
        ctx.lineWidth = 2;
        ctx.strokeRect(x1 * scale, y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale);

        const label = `${d.label} (${(d.score * 100).toFixed(0)}%)` + (isTarget ? ' ← target' : '');
        const fontSize = Math.max(11, Math.round(14 * scale));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const tw = ctx.measureText(label).width;
        const lh = fontSize + 6;
        const ly = y1 * scale - lh;
        ctx.fillStyle = isTarget ? 'rgba(76,175,80,0.85)' : 'rgba(244,67,54,0.85)';
        ctx.fillRect(x1 * scale, Math.max(0, ly), tw + 8, lh);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x1 * scale + 4, Math.max(fontSize, ly + fontSize));
    }
}

function drawBoxPrompt(canvas, img, bbox, adultFaces) {
    const { ctx, scale } = drawScaled(canvas, img);
    const r = Math.max(8, Math.min(canvas.width, canvas.height) * 0.025);

    // Box prompt — 녹색 실선 사각형
    const [x1, y1, x2, y2] = bbox;
    ctx.strokeStyle = 'rgba(76, 175, 80, 0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x1 * scale, y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale);

    // 꼭짓점 표시
    const corners = [[x1, y1], [x2, y1], [x1, y2], [x2, y2]];
    ctx.fillStyle = 'rgba(76, 175, 80, 0.9)';
    for (const [cx, cy] of corners) {
        ctx.beginPath();
        ctx.arc(cx * scale, cy * scale, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
    }

    // Negative points (adults) — red
    for (const f of adultFaces) {
        const x = f.cx * scale, y = f.cy * scale;
        ctx.fillStyle = 'rgba(244, 67, 54, 0.9)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y); ctx.stroke();
    }

    // Legend
    const fontSize = Math.max(10, Math.round(12 * scale));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const lx = 8, ly = canvas.height - (adultFaces.length > 0 ? fontSize * 2 + 10 : fontSize + 8);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(lx - 4, ly - 4, 200 * scale, adultFaces.length > 0 ? fontSize * 2 + 12 : fontSize + 10);
    ctx.fillStyle = '#4caf50';
    ctx.fillText('□ box prompt (아이)', lx, ly + fontSize);
    if (adultFaces.length > 0) {
        ctx.fillStyle = '#f44336';
        ctx.fillText('● neg points (어른)', lx, ly + fontSize * 2 + 4);
    }
}

// ========== Object Selection (Click / Auto Segment) ==========

function resetObjectSelection() {
    objSelImage = null;
    objSelScale = 1;
    objSelMaskData = null;
    objSelSegResult = null;
    objSelSegments = null;
    objSelLabelMap = null;
    objSelHoveredIdx = 0;
    objSelSelectedIdx = 0;
    objSelFaces = [];
    const canvas = document.getElementById('objsel-canvas');
    canvas.onclick = null;
    canvas.onmousemove = null;
    canvas.onmouseleave = null;
    canvas.style.cursor = '';
    const container = document.getElementById('objsel-container');
    container.classList.remove('visible');
    document.getElementById('objsel-footer').textContent = '';
    document.getElementById('objsel-hint').textContent = '분리할 오브젝트를 클릭하세요';
}

function getObjSelMode() {
    return document.querySelector('input[name="objsel-mode"]:checked')?.value || 'click';
}

async function runObjectSelection(img) {
    objSelImage = img;
    objSelSegResult = null;
    objSelMaskData = null;
    objSelSegments = null;
    objSelLabelMap = null;
    objSelHoveredIdx = 0;
    objSelSelectedIdx = 0;

    const mode = getObjSelMode();
    if (mode === 'auto') {
        await runAutoSegment(img);
    } else {
        await runClickMode(img);
    }
}

// ===== Click Segment Mode =====
let objSelFaces = []; // face-api.js 감지 결과

async function runClickMode(img) {
    const canvas = document.getElementById('objsel-canvas');
    const hint = document.getElementById('objsel-hint');
    const footer = document.getElementById('objsel-footer');
    const origW = img.width, origH = img.height;
    const maxW = 800, maxH = 500;
    objSelScale = Math.min(1, maxW / origW, maxH / origH);
    canvas.width = Math.round(origW * objSelScale);
    canvas.height = Math.round(origH * objSelScale);

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.style.cursor = 'crosshair';
    canvas.onmousemove = null;
    canvas.onmouseleave = null;

    // UI 표시
    const container = document.getElementById('objsel-container');
    container.classList.add('visible');
    hint.textContent = '얼굴 감지 중...';
    footer.textContent = '';

    // face-api.js로 얼굴 감지
    objSelFaces = [];
    const loaded = await loadFaceApi();
    if (loaded) {
        objSelFaces = await detectFacesInImage(img);
    }

    // 캔버스에 얼굴 박스 표시
    drawClickModeCanvas(canvas, img, objSelFaces, -1);

    if (objSelFaces.length > 0) {
        hint.textContent = `사람(${objSelFaces.length}명) 또는 오브젝트를 클릭하세요`;
        footer.textContent = '얼굴을 클릭하면 해당 사람만 정확하게 분리합니다';
    } else {
        hint.textContent = '분리할 오브젝트를 클릭하세요';
        footer.textContent = '얼굴이 감지되지 않았습니다';
    }

    // hover: 얼굴 위에 마우스가 올라가면 하이라이트
    canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const origX = (e.clientX - rect.left) / rect.width * origW;
        const origY = (e.clientY - rect.top) / rect.height * origH;
        const hovIdx = findFaceAtPoint(origX, origY);
        canvas.style.cursor = hovIdx >= 0 ? 'pointer' : 'crosshair';
    };
    canvas.onmouseleave = () => { canvas.style.cursor = 'crosshair'; };

    // 클릭 이벤트
    canvas.onclick = async (e) => {
        const rect = canvas.getBoundingClientRect();
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        const origX = cssX / rect.width * origW;
        const origY = cssY / rect.height * origH;

        const faceIdx = findFaceAtPoint(origX, origY);
        if (faceIdx >= 0) {
            // 얼굴 클릭 → 해당 얼굴 중심을 positive, 나머지를 negative
            const clickedFace = objSelFaces[faceIdx];
            const negFaces = objSelFaces.filter((_, i) => i !== faceIdx);
            // face bbox → body bbox 확장 (얼굴 아래로 ~6배)
            const bodyBox = faceToBodyBox(clickedFace, origW, origH);
            console.log(`[objsel] face click: idx=${faceIdx}, center=(${clickedFace.cx.toFixed(0)},${clickedFace.cy.toFixed(0)}), box=[${bodyBox.map(v=>v.toFixed(0)).join(',')}]`);
            await runClickSegment(clickedFace.cx, clickedFace.cy, negFaces, bodyBox);
        } else {
            console.log(`[objsel] raw click: (${origX.toFixed(0)}, ${origY.toFixed(0)})`);
            // 빈 영역 클릭 → raw 좌표
            await runClickSegment(origX, origY, []);
        }
    };

}

function faceToBodyBox(face, imgW, imgH) {
    // 얼굴 bbox에서 전신 bbox 추정
    // 좌우: 얼굴 너비 * 2.5배 (어깨 포함)
    // 위: 얼굴 위쪽 약간 여유
    // 아래: 얼굴 높이 * 7배 (전신 추정)
    const fw = face.width, fh = face.height;
    const cx = face.cx, cy = face.cy;
    const halfW = fw * 2.5 / 2;
    const x1 = Math.max(0, cx - halfW);
    const x2 = Math.min(imgW, cx + halfW);
    const y1 = Math.max(0, face.y - fh * 0.3);
    const y2 = Math.min(imgH, face.y + fh * 7);
    return [x1, y1, x2, y2];
}

function findFaceAtPoint(x, y) {
    for (let i = 0; i < objSelFaces.length; i++) {
        const f = objSelFaces[i];
        if (x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height) {
            return i;
        }
    }
    return -1;
}

function findDinoBoxAtPoint(x, y, detections) {
    for (let i = 0; i < detections.length; i++) {
        const [x1, y1, x2, y2] = detections[i].box;
        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return i;
    }
    return -1;
}

function drawDinoBoxesSelectable(canvas, img, detections, highlightIdx) {
    const { ctx, scale } = drawScaled(canvas, img);

    for (let i = 0; i < detections.length; i++) {
        const d = detections[i];
        const [x1, y1, x2, y2] = d.box;
        const sx = x1 * scale, sy = y1 * scale;
        const sw = (x2 - x1) * scale, sh = (y2 - y1) * scale;

        const isHover = i === highlightIdx;
        ctx.strokeStyle = isHover ? '#fff' : 'rgba(76, 175, 80, 0.8)';
        ctx.lineWidth = isHover ? 3 : 2;
        ctx.setLineDash(isHover ? [] : [6, 3]);
        ctx.strokeRect(sx, sy, sw, sh);
        ctx.setLineDash([]);

        const scoreStr = d.score < 1.0 ? ` (${(d.score * 100).toFixed(0)}%)` : '';
        const label = `${d.label || '객체'} ${i + 1}${scoreStr}`;
        const fontSize = Math.max(11, Math.round(14 * scale));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const tw = ctx.measureText(label).width;
        const lh = fontSize + 6;
        const ly = sy - lh;
        ctx.fillStyle = isHover ? 'rgba(255,255,255,0.9)' : 'rgba(76,175,80,0.85)';
        ctx.fillRect(sx, Math.max(0, ly), tw + 8, lh);
        ctx.fillStyle = isHover ? '#000' : '#fff';
        ctx.fillText(label, sx + 4, Math.max(fontSize, ly + fontSize));
    }

    // 하단 배너
    const bannerH = Math.max(28, Math.round(32 * scale));
    ctx.fillStyle = 'rgba(255, 213, 79, 0.92)';
    ctx.fillRect(0, canvas.height - bannerH, canvas.width, bannerH);
    const bannerFont = Math.max(12, Math.round(14 * scale));
    ctx.font = `bold ${bannerFont}px sans-serif`;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.fillText('대상을 클릭하세요', canvas.width / 2, canvas.height - bannerH / 2 + bannerFont / 3);
    ctx.textAlign = 'start';
}

function drawClickModeCanvas(canvas, img, faces, highlightIdx) {
    const ctx = canvas.getContext('2d');
    const scale = objSelScale;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        const x = f.x * scale, y = f.y * scale;
        const w = f.width * scale, h = f.height * scale;

        // 얼굴 박스
        ctx.strokeStyle = i === highlightIdx ? '#fff' : 'rgba(76, 175, 80, 0.8)';
        ctx.lineWidth = i === highlightIdx ? 3 : 2;
        ctx.setLineDash(i === highlightIdx ? [] : [6, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);

        // 라벨
        const label = `사람 ${i + 1}`;
        const fontSize = Math.max(11, Math.round(13 * scale));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const tw = ctx.measureText(label).width;
        const ly = y - fontSize - 4;
        ctx.fillStyle = i === highlightIdx ? 'rgba(255,255,255,0.9)' : 'rgba(76,175,80,0.85)';
        ctx.fillRect(x, Math.max(0, ly), tw + 8, fontSize + 4);
        ctx.fillStyle = i === highlightIdx ? '#000' : '#fff';
        ctx.fillText(label, x + 4, Math.max(fontSize, ly + fontSize));
    }
}

async function runClickSegment(pointX, pointY, negFaces = [], boxPrompt = null) {
    const canvas = document.getElementById('objsel-canvas');
    const hint = document.getElementById('objsel-hint');
    const footer = document.getElementById('objsel-footer');
    hint.textContent = 'SAM2 세그멘테이션 중...';
    const negInfo = negFaces.length > 0 ? ` | neg: ${negFaces.length}명` : '';
    footer.textContent = `클릭: (${pointX.toFixed(0)}, ${pointY.toFixed(0)})${negInfo}`;

    // 캔버스에 클릭 포인트 표시
    const ctx = canvas.getContext('2d');
    ctx.drawImage(objSelImage, 0, 0, canvas.width, canvas.height);
    // 어둡게
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // positive 마커 (녹색)
    const mx = pointX * objSelScale;
    const my = pointY * objSelScale;
    ctx.fillStyle = '#4caf50';
    ctx.beginPath();
    ctx.arc(mx, my, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // + 기호
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('+', mx, my + 4);
    ctx.textAlign = 'start';
    // negative 마커 (빨간색)
    for (const f of negFaces) {
        const nx = f.cx * objSelScale, ny = f.cy * objSelScale;
        ctx.fillStyle = '#f44336';
        ctx.beginPath();
        ctx.arc(nx, ny, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('−', nx, ny + 3.5);
        ctx.textAlign = 'start';
    }
    // box prompt 시각화 (녹색 점선)
    if (boxPrompt) {
        const [bx1, by1, bx2, by2] = boxPrompt;
        ctx.strokeStyle = 'rgba(76, 175, 80, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(bx1 * objSelScale, by1 * objSelScale,
            (bx2 - bx1) * objSelScale, (by2 - by1) * objSelScale);
        ctx.setLineDash([]);
    }

    try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('point_x', pointX.toString());
        formData.append('point_y', pointY.toString());
        if (negFaces.length > 0) {
            formData.append('neg_points', JSON.stringify(negFaces.map(f => [f.cx, f.cy])));
        }
        if (boxPrompt) {
            formData.append('box', JSON.stringify(boxPrompt));
        }

        const startTime = performance.now();
        const resp = await fetch(`${API_URL}/segment-child`, { method: 'POST', body: formData });
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

        if (!resp.ok) {
            const errData = await resp.json().catch(() => null);
            throw new Error(extractErrorDetail(errData, `SAM2 오류 (${resp.status})`));
        }

        const cropX = parseInt(resp.headers.get('X-Crop-X') || '0');
        const cropY = parseInt(resp.headers.get('X-Crop-Y') || '0');
        const score = resp.headers.get('X-SAM2-Score') || '?';

        const blob = await resp.blob();
        const segImg = await blobToImage(blob);

        // 전체 크기 마스크 복원 (SAM2 결과 alpha → full-size mask)
        const origW = objSelImage.width, origH = objSelImage.height;
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = origW;
        maskCanvas.height = origH;
        const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
        // 투명 캔버스에 SAM2 결과를 원래 위치에 그리기 (검정 배경 X — alpha 보존)
        mCtx.drawImage(segImg, cropX, cropY);
        // alpha 채널 추출 (투명=0, 오브젝트=255)
        const fullData = mCtx.getImageData(0, 0, origW, origH);
        const px = fullData.data;
        for (let i = 0; i < origW * origH; i++) {
            const a = px[i * 4 + 3];
            px[i * 4] = a;
            px[i * 4 + 1] = a;
            px[i * 4 + 2] = a;
            px[i * 4 + 3] = 255;
        }
        mCtx.putImageData(fullData, 0, 0);
        objSelMaskData = mCtx.getImageData(0, 0, origW, origH);

        objSelSegResult = { image: segImg, cropX, cropY, score, blob };

        // 오버레이 렌더링: 원본 어둡게 + 선택 영역 밝게 + 녹색 테두리
        drawClickMaskOverlay();

        hint.textContent = '배경 제거 중...';
        footer.textContent = `Score: ${score} | ${segImg.width}x${segImg.height} | ${elapsed}초`;

        // 바로 배경 제거 진행
        proceedWithObjSelMask();

    } catch (err) {
        hint.textContent = '오류 — 다시 클릭하세요';
        footer.textContent = err.message;
        // 원본 복원
        ctx.drawImage(objSelImage, 0, 0, canvas.width, canvas.height);
    }
}

function drawClickMaskOverlay() {
    const canvas = document.getElementById('objsel-canvas');
    const ctx = canvas.getContext('2d');
    const cw = canvas.width, ch = canvas.height;
    const origW = objSelImage.width, origH = objSelImage.height;

    // 원본 그리기
    ctx.drawImage(objSelImage, 0, 0, cw, ch);
    const imgData = ctx.getImageData(0, 0, cw, ch);
    const pixels = imgData.data;
    const mask = objSelMaskData.data;

    for (let cy = 0; cy < ch; cy++) {
        for (let cx = 0; cx < cw; cx++) {
            const pi = (cy * cw + cx) * 4;
            // 캔버스 좌표 → 원본 좌표
            const ox = Math.min(origW - 1, Math.round(cx / objSelScale));
            const oy = Math.min(origH - 1, Math.round(cy / objSelScale));
            const mi = (oy * origW + ox) * 4;
            const maskVal = mask[mi]; // R = alpha (0 or 255)

            if (maskVal < 128) {
                // 배경: 어둡게
                pixels[pi] = pixels[pi] * 0.3 | 0;
                pixels[pi + 1] = pixels[pi + 1] * 0.3 | 0;
                pixels[pi + 2] = pixels[pi + 2] * 0.3 | 0;
            }
            // 선택 영역: 원본 밝기 유지
        }
    }
    ctx.putImageData(imgData, 0, 0);

    // 녹색 테두리 (마스크 경계)
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let cy = 0; cy < ch; cy++) {
        for (let cx = 0; cx < cw; cx++) {
            const ox = Math.min(origW - 1, Math.round(cx / objSelScale));
            const oy = Math.min(origH - 1, Math.round(cy / objSelScale));
            const v = mask[(oy * origW + ox) * 4];
            if (v < 128) continue;
            // 4방향 중 하나라도 마스크 밖이면 경계
            const check = (dx, dy) => {
                const nx = ox + dx, ny = oy + dy;
                if (nx < 0 || nx >= origW || ny < 0 || ny >= origH) return true;
                return mask[(ny * origW + nx) * 4] < 128;
            };
            if (check(-1, 0) || check(1, 0) || check(0, -1) || check(0, 1)) {
                ctx.rect(cx, cy, 1, 1);
            }
        }
    }
    ctx.stroke();
}

// ===== Auto Segment Mode =====
function segmentColorRGBA(index, alpha) {
    const hue = ((index - 1) * 137.508) % 360;
    const s = 0.7, l = 0.55;
    // HSL → RGB
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    let r, g, b;
    if (hue < 60) { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return [(r + m) * 255 | 0, (g + m) * 255 | 0, (b + m) * 255 | 0, alpha];
}

async function runAutoSegment(img) {
    const canvas = document.getElementById('objsel-canvas');
    const hint = document.getElementById('objsel-hint');
    const footer = document.getElementById('objsel-footer');
    const container = document.getElementById('objsel-container');

    const origW = img.width, origH = img.height;
    const maxW = 800, maxH = 500;
    objSelScale = Math.min(1, maxW / origW, maxH / origH);
    canvas.width = Math.round(origW * objSelScale);
    canvas.height = Math.round(origH * objSelScale);

    // 로딩 표시
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('자동 세그멘테이션 중...', canvas.width / 2, canvas.height / 2);
    ctx.textAlign = 'start';

    container.classList.add('visible');
    hint.textContent = '자동 세그멘테이션 중...';
    footer.textContent = '';

    try {
        const minArea = document.getElementById('objsel-min-area').value;
        const maxMasks = document.getElementById('objsel-max-masks').value;

        const formData = new FormData();
        formData.append('file', selectedFile);

        const startTime = performance.now();
        const resp = await fetch(`${API_URL}/segment-all?min_area_pct=${minArea}&max_masks=${maxMasks}`, {
            method: 'POST', body: formData
        });
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

        if (!resp.ok) {
            const errData = await resp.json().catch(() => null);
            throw new Error(extractErrorDetail(errData, `세그먼트 오류 (${resp.status})`));
        }

        const data = await resp.json();
        objSelSegments = data.segments;

        // label map 디코딩
        const lmImg = new Image();
        await new Promise((resolve, reject) => {
            lmImg.onload = resolve;
            lmImg.onerror = reject;
            lmImg.src = 'data:image/png;base64,' + data.label_map;
        });
        const lmCanvas = document.createElement('canvas');
        lmCanvas.width = data.image_width;
        lmCanvas.height = data.image_height;
        const lmCtx = lmCanvas.getContext('2d', { willReadFrequently: true });
        lmCtx.drawImage(lmImg, 0, 0);
        objSelLabelMap = lmCtx.getImageData(0, 0, data.image_width, data.image_height);

        // 초기 렌더링
        objSelHoveredIdx = 0;
        objSelSelectedIdx = 0;
        drawAutoSegmentOverlay();
        setupAutoSegmentEvents();

        hint.textContent = '오브젝트를 클릭하여 선택하세요';
        footer.textContent = `${objSelSegments.length}개 세그먼트 감지 | ${elapsed}초`;

    } catch (err) {
        hint.textContent = '오류 발생';
        footer.textContent = err.message;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
}

function drawAutoSegmentOverlay() {
    const canvas = document.getElementById('objsel-canvas');
    const ctx = canvas.getContext('2d');
    const cw = canvas.width, ch = canvas.height;
    const origW = objSelImage.width, origH = objSelImage.height;

    // 원본 그리기
    ctx.drawImage(objSelImage, 0, 0, cw, ch);
    const imgData = ctx.getImageData(0, 0, cw, ch);
    const px = imgData.data;
    const labelPx = objSelLabelMap.data;

    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            const pi = (y * cw + x) * 4;
            const ox = Math.min(origW - 1, Math.round(x / objSelScale));
            const oy = Math.min(origH - 1, Math.round(y / objSelScale));
            const li = (oy * origW + ox) * 4;
            const idx = labelPx[li]; // R channel = segment index

            if (idx === 0) {
                // 배경: 어둡게
                px[pi] = px[pi] * 0.3 | 0;
                px[pi + 1] = px[pi + 1] * 0.3 | 0;
                px[pi + 2] = px[pi + 2] * 0.3 | 0;
            } else if (idx === objSelSelectedIdx) {
                // 선택된 세그먼트: 밝은 원본 유지
            } else if (idx === objSelHoveredIdx) {
                // hover: 반투명 색상 오버레이
                const [cr, cg, cb] = segmentColorRGBA(idx, 100);
                px[pi] = (px[pi] * 0.6 + cr * 0.4) | 0;
                px[pi + 1] = (px[pi + 1] * 0.6 + cg * 0.4) | 0;
                px[pi + 2] = (px[pi + 2] * 0.6 + cb * 0.4) | 0;
            } else {
                // 다른 세그먼트: 살짝 어둡게 + 색상 틴트
                const [cr, cg, cb] = segmentColorRGBA(idx, 60);
                px[pi] = (px[pi] * 0.5 + cr * 0.15) | 0;
                px[pi + 1] = (px[pi + 1] * 0.5 + cg * 0.15) | 0;
                px[pi + 2] = (px[pi + 2] * 0.5 + cb * 0.15) | 0;
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);

    // 선택된 세그먼트 녹색 테두리
    if (objSelSelectedIdx > 0) {
        ctx.strokeStyle = '#4caf50';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
                const ox = Math.min(origW - 1, Math.round(x / objSelScale));
                const oy = Math.min(origH - 1, Math.round(y / objSelScale));
                const v = labelPx[(oy * origW + ox) * 4];
                if (v !== objSelSelectedIdx) continue;
                const check = (dx, dy) => {
                    const nx = ox + dx, ny = oy + dy;
                    if (nx < 0 || nx >= origW || ny < 0 || ny >= origH) return true;
                    return labelPx[(ny * origW + nx) * 4] !== objSelSelectedIdx;
                };
                if (check(-1, 0) || check(1, 0) || check(0, -1) || check(0, 1)) {
                    ctx.rect(x, y, 1, 1);
                }
            }
        }
        ctx.stroke();
    }

    // hover 세그먼트 흰색 테두리
    if (objSelHoveredIdx > 0 && objSelHoveredIdx !== objSelSelectedIdx) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
                const ox = Math.min(origW - 1, Math.round(x / objSelScale));
                const oy = Math.min(origH - 1, Math.round(y / objSelScale));
                const v = labelPx[(oy * origW + ox) * 4];
                if (v !== objSelHoveredIdx) continue;
                const check = (dx, dy) => {
                    const nx = ox + dx, ny = oy + dy;
                    if (nx < 0 || nx >= origW || ny < 0 || ny >= origH) return true;
                    return labelPx[(ny * origW + nx) * 4] !== objSelHoveredIdx;
                };
                if (check(-1, 0) || check(1, 0) || check(0, -1) || check(0, 1)) {
                    ctx.rect(x, y, 1, 1);
                }
            }
        }
        ctx.stroke();
    }
}

function setupAutoSegmentEvents() {
    const canvas = document.getElementById('objsel-canvas');
    const origW = objSelImage.width, origH = objSelImage.height;
    const labelPx = objSelLabelMap.data;
    let rafPending = false;

    canvas.style.cursor = 'pointer';

    canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / rect.width * canvas.width;
        const cy = (e.clientY - rect.top) / rect.height * canvas.height;
        const ox = Math.min(origW - 1, Math.round(cx / objSelScale));
        const oy = Math.min(origH - 1, Math.round(cy / objSelScale));
        const idx = labelPx[(oy * origW + ox) * 4];
        if (idx !== objSelHoveredIdx) {
            objSelHoveredIdx = idx;
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(() => {
                    drawAutoSegmentOverlay();
                    rafPending = false;
                });
            }
        }
    };

    canvas.onmouseleave = () => {
        if (objSelHoveredIdx !== 0) {
            objSelHoveredIdx = 0;
            drawAutoSegmentOverlay();
        }
    };

    canvas.onclick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / rect.width * canvas.width;
        const cy = (e.clientY - rect.top) / rect.height * canvas.height;
        const ox = Math.min(origW - 1, Math.round(cx / objSelScale));
        const oy = Math.min(origH - 1, Math.round(cy / objSelScale));
        const idx = labelPx[(oy * origW + ox) * 4];

        if (idx === 0) return; // 배경 클릭 무시
        objSelSelectedIdx = idx;
        drawAutoSegmentOverlay();

        const seg = objSelSegments.find(s => s.index === objSelSelectedIdx);
        document.getElementById('objsel-footer').textContent =
            `세그먼트 #${objSelSelectedIdx} 선택 | ${seg ? seg.area_pct.toFixed(1) + '% | Score: ' + seg.score.toFixed(3) : ''}`;
        document.getElementById('objsel-hint').textContent = '배경 제거 중...';

        // 마스크 데이터 구성 → 바로 배경 제거
        buildMaskFromLabelMap(objSelSelectedIdx);
        proceedWithObjSelMask();
    };
}

function buildMaskFromLabelMap(segIdx) {
    const origW = objSelImage.width, origH = objSelImage.height;
    const labelPx = objSelLabelMap.data;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = origW;
    maskCanvas.height = origH;
    const mCtx = maskCanvas.getContext('2d');
    const maskImgData = mCtx.createImageData(origW, origH);
    const mp = maskImgData.data;
    for (let i = 0; i < origW * origH; i++) {
        const v = labelPx[i * 4] === segIdx ? 255 : 0;
        mp[i * 4] = v;
        mp[i * 4 + 1] = v;
        mp[i * 4 + 2] = v;
        mp[i * 4 + 3] = 255;
    }
    mCtx.putImageData(maskImgData, 0, 0);
    objSelMaskData = mCtx.getImageData(0, 0, origW, origH);
}

// ===== 공통: 선택한 마스크로 배경 제거 =====
async function proceedWithObjSelMask() {
    if (!objSelMaskData || !objSelImage) return;

    showLoading();
    els.loadingText.textContent = '선택한 오브젝트로 배경 제거 중...';
    const startTime = performance.now();
    let timerInterval = setInterval(() => {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        els.loadingTime.textContent = `${elapsed}초 경과`;
    }, 100);

    try {
        const w = objSelImage.width, h = objSelImage.height;
        const maskPx = objSelMaskData.data;

        const useViTMatte = document.getElementById('vitmatte-check').checked;

        if (useViTMatte) {
            // 마스크를 PNG로 변환하여 ViTMatte에 전송
            els.loadingText.textContent = 'ViTMatte 정밀 매팅 중...';
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = w;
            maskCanvas.height = h;
            const mCtx = maskCanvas.getContext('2d');
            mCtx.putImageData(objSelMaskData, 0, 0);

            const maskBlob = await new Promise((resolve, reject) => {
                maskCanvas.toBlob(b => b ? resolve(b) : reject(new Error('마스크 생성 실패')), 'image/png');
            });

            const vitFormData = new FormData();
            vitFormData.append('file', selectedFile);
            vitFormData.append('mask', new File([maskBlob], 'mask.png', { type: 'image/png' }));

            const vitResp = await fetch(`${API_URL}/vitmatte`, { method: 'POST', body: vitFormData });
            if (!vitResp.ok) {
                const errData = await vitResp.json().catch(() => null);
                throw new Error(extractErrorDetail(errData, `ViTMatte 서버 오류 (${vitResp.status})`));
            }

            processedBlob = await vitResp.blob();
            resultImage = await blobToImage(processedBlob);
        } else {
            // SAM2 마스크로 bbox 크롭 → bg-removal 모델로 배경 제거
            els.loadingText.textContent = '오브젝트 크롭 중...';

            // 마스크 bbox 계산
            let minX = w, minY = h, maxX = 0, maxY = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (maskPx[(y * w + x) * 4] > 0) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            // SAM2 패딩 설정 적용
            const padPct = parseInt(document.getElementById('sam2-padding-slider').value) || 15;
            const maskW = maxX - minX + 1, maskH = maxY - minY + 1;
            const padX = Math.round(maskW * padPct / 100);
            const padY = Math.round(maskH * padPct / 100);
            const cropX = Math.max(0, minX - padX);
            const cropY = Math.max(0, minY - padY);
            const cropR = Math.min(w, maxX + 1 + padX);
            const cropB = Math.min(h, maxY + 1 + padY);
            const finalW = cropR - cropX;
            const finalH = cropB - cropY;

            // 원본 이미지에서 bbox 크롭 (배경 포함)
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = finalW;
            cropCanvas.height = finalH;
            const cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(objSelImage, cropX, cropY, finalW, finalH, 0, 0, finalW, finalH);

            const cropBlob = await new Promise((resolve, reject) => {
                cropCanvas.toBlob(b => b ? resolve(b) : reject(new Error('크롭 실패')), 'image/png');
            });

            // bg-removal 모델로 배경 제거
            const model = document.querySelector('input[name="model"]:checked')?.value || 'portrait';
            const maxSize = getMaxSize();

            els.loadingText.textContent = `${model} 모델로 배경 제거 중...`;

            const bgFormData = new FormData();
            bgFormData.append('file', new File([cropBlob], 'crop.png', { type: 'image/png' }));

            const bgUrl = `${API_URL}/remove-bg?max_size=${maxSize}&model=${model}`;
            const bgResp = await fetch(bgUrl, { method: 'POST', body: bgFormData });

            if (!bgResp.ok) {
                const errData = await bgResp.json().catch(() => null);
                throw new Error(extractErrorDetail(errData, `배경 제거 오류 (${bgResp.status})`));
            }

            const bgqaScore = parseFloat(bgResp.headers.get('X-BGQA-Score') || '0');
            const bgqaPassed = bgResp.headers.get('X-BGQA-Passed') === 'true';
            const bgqaIssues = bgResp.headers.get('X-BGQA-Issues') || '';

            processedBlob = await bgResp.blob();
            resultImage = await blobToImage(processedBlob);

            // BGQA 배지 표시
            showBgqaBadge({
                bgqaScore, bgqaPassed, bgqaIssues,
                bgqaCaseType: bgResp.headers.get('X-BGQA-CaseType') || '',
            });
        }

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

        renderResult(resultImage);
        renderPreviews(resultImage);

        const model = document.querySelector('input[name="model"]:checked')?.value || '';
        els.processingInfo.textContent = useViTMatte
            ? `오브젝트 선택 → ViTMatte | ${resultImage.width}x${resultImage.height} | ${elapsed}초`
            : `오브젝트 선택 → ${model} | ${resultImage.width}x${resultImage.height} | ${elapsed}초`;
        els.processingInfo.classList.add('visible');
        els.compareSection.classList.add('visible');
        els.previewSection.classList.add('visible');
        els.downloadSection.classList.add('visible');

    } catch (err) {
        showError(err.message || String(err));
    } finally {
        clearInterval(timerInterval);
        hideLoading();
    }
}

// ========== Pipeline Compare Test ==========

const cmpSection = document.getElementById('compare-test');
const cmpResultsGrid = document.getElementById('cmp-results');
const cmpRunBtn = document.getElementById('cmp-run-btn');
const cmpComboCount = document.getElementById('cmp-combo-count');
const cmpModal = document.getElementById('cmp-modal');
const cmpModalImg = document.getElementById('cmp-modal-img');
const cmpModalInfo = document.getElementById('cmp-modal-info');

// Show compare section when file is uploaded
function showCompareTest() {
    if (selectedFile && !cpCheck.checked) cmpSection.style.display = '';
    else cmpSection.style.display = 'none';
    updateCmpComboCount();
    // Also update CPX run button state
    try { if (cpxRunBtn) cpxRunBtn.disabled = cpxSlots.length < 2 || !selectedFile; } catch (_) {}
}

// Observe upload area class to detect file selection
const uploadObs = new MutationObserver(() => showCompareTest());
uploadObs.observe(els.uploadArea, { attributes: true, attributeFilter: ['class'] });

// --- Combo counting ---

function getCmpCombos() {
    const detects = [...document.querySelectorAll('#cmp-detect-checks input:checked')].map(i => i.value);
    const models = [...document.querySelectorAll('#cmp-model-checks input:checked')].map(i => i.value);

    const combos = [];
    for (const d of detects) {
        for (const m of models) {
            // ViTMatte requires SAM2 (detection != none)
            if (m === 'vitmatte' && d === 'none') continue;
            combos.push({ detection: d, model: m });
        }
    }
    return combos;
}

function updateCmpComboCount() {
    const combos = getCmpCombos();
    cmpComboCount.innerHTML = `총 <strong>${combos.length}</strong>개 조합`;
    cmpRunBtn.disabled = combos.length === 0 || !selectedFile;

    // Grey out ViTMatte label if only 'none' detection is checked
    const detects = [...document.querySelectorAll('#cmp-detect-checks input:checked')].map(i => i.value);
    const vitLabel = [...document.querySelectorAll('#cmp-model-checks .cmp-check-label')].find(
        l => l.querySelector('input').value === 'vitmatte'
    );
    if (vitLabel) {
        const onlyNone = detects.every(d => d === 'none');
        vitLabel.classList.toggle('disabled', onlyNone && detects.length > 0);
    }
}

document.querySelectorAll('#cmp-detect-checks input, #cmp-model-checks input').forEach(cb => {
    cb.addEventListener('change', updateCmpComboCount);
});

updateCmpComboCount();

// --- Modal ---

cmpModal.addEventListener('click', () => {
    cmpModal.classList.remove('visible');
});

function showCompareModal(imgSrc, infoText) {
    cmpModalImg.src = imgSrc;
    cmpModalInfo.textContent = infoText || '';
    cmpModal.classList.add('visible');
}

// --- Card rendering ---

function createCmpCard(combo) {
    const card = document.createElement('div');
    card.className = 'cmp-card pending';

    const imgArea = document.createElement('div');
    imgArea.className = 'cmp-card-img checker-bg';
    const spinner = document.createElement('div');
    spinner.className = 'cmp-spinner';
    spinner.style.display = 'none';
    imgArea.appendChild(spinner);
    card.appendChild(imgArea);

    const meta = document.createElement('div');
    meta.className = 'cmp-card-meta';

    const badges = document.createElement('div');
    badges.className = 'cmp-pipeline-badges';

    if (combo.detection !== 'none') {
        const dBadge = document.createElement('span');
        dBadge.className = 'cmp-badge detect';
        dBadge.textContent = combo.detection === 'faceapi' ? 'face-api' : 'DINO';
        badges.appendChild(dBadge);

        const sBadge = document.createElement('span');
        sBadge.className = 'cmp-badge sam2';
        sBadge.textContent = 'SAM2';
        badges.appendChild(sBadge);
    }

    const mBadge = document.createElement('span');
    mBadge.className = 'cmp-badge model';
    mBadge.textContent = combo.model === 'vitmatte' ? 'ViTMatte' : combo.model;
    badges.appendChild(mBadge);

    meta.appendChild(badges);

    const metrics = document.createElement('div');
    metrics.className = 'cmp-metrics';
    metrics.textContent = '대기 중...';
    meta.appendChild(metrics);

    card.appendChild(meta);

    const dlArea = document.createElement('div');
    dlArea.className = 'cmp-card-dl';
    card.appendChild(dlArea);

    card._imgArea = imgArea;
    card._spinner = spinner;
    card._metrics = metrics;
    card._dlArea = dlArea;
    card._combo = combo;

    return card;
}

function updateCmpCard(card, result) {
    const imgArea = card._imgArea;
    const metrics = card._metrics;

    card._spinner.style.display = 'none';

    if (result.error) {
        card.className = 'cmp-card error';
        const icon = document.createElement('div');
        icon.className = 'cmp-error-icon';
        icon.textContent = '!';
        imgArea.appendChild(icon);
        metrics.innerHTML = `<span class="cmp-error-msg">${result.error}</span>`;
        return;
    }

    card.className = 'cmp-card done';

    const img = document.createElement('img');
    img.src = result.imageSrc;
    imgArea.appendChild(img);

    imgArea.addEventListener('click', () => {
        const combo = card._combo;
        const label = combo.detection === 'none'
            ? combo.model
            : `${combo.detection === 'faceapi' ? 'face-api' : 'DINO'} → SAM2 → ${combo.model}`;
        showCompareModal(result.imageSrc, `${label} | ${result.width}x${result.height} | ${result.elapsed}s`);
    });

    let html = `${result.elapsed}s`;
    if (result.bgqa != null) {
        const passStyle = result.bgqaPassed ? 'color:#4caf50' : 'color:#f44336';
        html += ` | <span style="${passStyle}">BGQA ${result.bgqa.toFixed(1)}</span>`;
    }
    html += ` | ${result.width}x${result.height}`;
    metrics.innerHTML = html;

    // 다운로드 버튼
    const combo = card._combo;
    const dlBtn = document.createElement('button');
    dlBtn.className = 'cmp-dl-btn';
    dlBtn.textContent = 'PNG 다운로드';
    dlBtn.addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        const img = imgArea.querySelector('img');
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const det = combo.detection === 'none' ? 'direct' : combo.detection;
            const baseName = selectedFile ? selectedFile.name.replace(/\.[^.]+$/, '') : 'result';
            a.download = `${baseName}_${det}_${combo.model}.png`;
            a.click();
            URL.revokeObjectURL(url);
        }, 'image/png');
    });
    card._dlArea.appendChild(dlBtn);
}

// --- Single pipeline runner (DOM-independent) ---

async function runSinglePipeline({ detection, model, file }) {
    const startTime = performance.now();
    const maxSize = getMaxSize();
    const padPct = parseInt(sam2PaddingSlider.value) / 100;

    try {
        let fileToSend = file;

        if (detection === 'faceapi' || detection === 'dino') {
            const img = await blobToImage(file);
            let childFace, adultFaces = [], dinoBbox = null;

            if (detection === 'dino') {
                const dinoFormData = new FormData();
                dinoFormData.append('file', file);
                const dinoResp = await fetch(`${API_URL}/detect-child`, { method: 'POST', body: dinoFormData });
                if (!dinoResp.ok) {
                    const errData = await dinoResp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `DINO error (${dinoResp.status})`));
                }
                const dinoResult = await dinoResp.json();
                const dinoBoxes = dinoResult.detections || [];
                if (dinoBoxes.length < 1) throw new Error('DINO: no child detected');

                const sorted = [...dinoBoxes].sort((a, b) => {
                    return ((a.box[2]-a.box[0])*(a.box[3]-a.box[1])) - ((b.box[2]-b.box[0])*(b.box[3]-b.box[1]));
                });
                const childBox = sorted[0];
                dinoBbox = childBox.box;
                childFace = {
                    cx: (dinoBbox[0] + dinoBbox[2]) / 2,
                    cy: (dinoBbox[1] + dinoBbox[3]) / 2,
                };
                adultFaces = sorted.slice(1).map(d => ({
                    cx: (d.box[0] + d.box[2]) / 2,
                    cy: (d.box[1] + d.box[3]) / 2,
                }));
            } else {
                // face-api detection
                const loaded = await loadFaceApi();
                if (!loaded) throw new Error('face-api.js load failed');
                const faces = await detectFacesInImage(img);
                if (faces.length < 1) throw new Error('No face detected');

                childFace = faces[faces.length - 1];
                adultFaces = faces.length > 1 ? faces.slice(0, -1) : [];

                const bodyBox = faceToBodyBox(childFace, img.width, img.height);
                dinoBbox = bodyBox;
            }

            // SAM2 segmentation
            const sam2FormData = new FormData();
            sam2FormData.append('file', file);
            sam2FormData.append('point_x', childFace.cx.toString());
            sam2FormData.append('point_y', childFace.cy.toString());
            if (adultFaces.length > 0) {
                sam2FormData.append('neg_points', JSON.stringify(adultFaces.map(f => [f.cx, f.cy])));
            }
            if (dinoBbox) {
                sam2FormData.append('box', JSON.stringify(dinoBbox));
            }

            const sam2Resp = await fetch(`${API_URL}/segment-child`, { method: 'POST', body: sam2FormData });
            if (!sam2Resp.ok) {
                const errData = await sam2Resp.json().catch(() => null);
                throw new Error(extractErrorDetail(errData, `SAM2 error (${sam2Resp.status})`));
            }

            const sam2CropX = parseInt(sam2Resp.headers.get('X-Crop-X') || '0');
            const sam2CropY = parseInt(sam2Resp.headers.get('X-Crop-Y') || '0');
            const sam2CropW = parseInt(sam2Resp.headers.get('X-Crop-Width') || '0');
            const sam2CropH = parseInt(sam2Resp.headers.get('X-Crop-Height') || '0');

            const sam2Blob = await sam2Resp.blob();
            const sam2Image = await blobToImage(sam2Blob);

            if (model === 'vitmatte') {
                // ViTMatte: SAM2 mask → alpha matting
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = img.width;
                maskCanvas.height = img.height;
                const mCtx = maskCanvas.getContext('2d');
                // 투명 캔버스에 SAM2 결과 그리기 (alpha 보존)
                mCtx.clearRect(0, 0, img.width, img.height);
                mCtx.drawImage(sam2Image, sam2CropX, sam2CropY);
                const imgData = mCtx.getImageData(0, 0, img.width, img.height);
                const px = imgData.data;
                for (let i = 0; i < px.length; i += 4) {
                    const a = px[i + 3];
                    px[i] = a; px[i + 1] = a; px[i + 2] = a; px[i + 3] = 255;
                }
                mCtx.putImageData(imgData, 0, 0);
                const maskBlob = await new Promise((res, rej) => {
                    maskCanvas.toBlob(b => b ? res(b) : rej(new Error('mask fail')), 'image/png');
                });

                const vitFormData = new FormData();
                vitFormData.append('file', file);
                vitFormData.append('mask', new File([maskBlob], 'mask.png', { type: 'image/png' }));

                const vitResp = await fetch(`${API_URL}/vitmatte`, { method: 'POST', body: vitFormData });
                if (!vitResp.ok) {
                    const errData = await vitResp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `ViTMatte error (${vitResp.status})`));
                }

                const resultBlob = await vitResp.blob();
                const resultImg = await blobToImage(resultBlob);
                const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
                return {
                    imageSrc: URL.createObjectURL(resultBlob),
                    width: resultImg.width,
                    height: resultImg.height,
                    elapsed,
                    bgqa: null,
                    bgqaPassed: null,
                };
            } else {
                // Crop with padding → bg-removal model
                const padW = Math.round(sam2CropW * padPct);
                const padH = Math.round(sam2CropH * padPct);
                const cropX = Math.max(0, sam2CropX - padW);
                const cropY = Math.max(0, sam2CropY - padH);
                const cropR = Math.min(img.width, sam2CropX + sam2CropW + padW);
                const cropB = Math.min(img.height, sam2CropY + sam2CropH + padH);

                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = cropR - cropX;
                cropCanvas.height = cropB - cropY;
                const cropCtx = cropCanvas.getContext('2d');
                cropCtx.drawImage(img, cropX, cropY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);

                const cropBlob = await new Promise((res, rej) => {
                    cropCanvas.toBlob(b => b ? res(b) : rej(new Error('crop fail')), 'image/jpeg', 0.85);
                });
                fileToSend = new File([cropBlob], 'sam2_crop.jpg', { type: 'image/jpeg' });
            }
        }

        // BG removal model call
        const formData = new FormData();
        formData.append('file', fileToSend);

        const url = `${API_URL}/remove-bg?max_size=${maxSize}&model=${model}`;
        const resp = await fetch(url, { method: 'POST', body: formData });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => null);
            throw new Error(extractErrorDetail(errData, `BG error (${resp.status})`));
        }

        const bgqaScore = parseFloat(resp.headers.get('X-BGQA-Score') || '0');
        const bgqaPassed = resp.headers.get('X-BGQA-Passed') === 'true';

        const blob = await resp.blob();
        const resultImg = await blobToImage(blob);
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

        return {
            imageSrc: URL.createObjectURL(blob),
            width: resultImg.width,
            height: resultImg.height,
            elapsed,
            bgqa: bgqaScore,
            bgqaPassed,
        };

    } catch (err) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        return { error: err.message || String(err), elapsed };
    }
}

// --- Comparison controller ---

let cmpRunning = false;

async function runComparisonTest() {
    if (!selectedFile || cmpRunning) return;

    const combos = getCmpCombos();
    if (combos.length === 0) return;

    cmpRunning = true;
    cmpRunBtn.disabled = true;
    cmpRunBtn.textContent = '실행 중...';
    cmpResultsGrid.innerHTML = '';
    cmpResultsGrid.classList.add('visible');

    const cards = combos.map(combo => {
        const card = createCmpCard(combo);
        cmpResultsGrid.appendChild(card);
        return card;
    });

    // Sequential execution (single GPU)
    for (let i = 0; i < combos.length; i++) {
        const card = cards[i];
        card.className = 'cmp-card running';
        card._spinner.style.display = 'block';
        card._metrics.textContent = `처리 중... (${i + 1}/${combos.length})`;

        const result = await runSinglePipeline({
            detection: combos[i].detection,
            model: combos[i].model,
            file: selectedFile,
        });

        updateCmpCard(card, result);
    }

    cmpRunning = false;
    cmpRunBtn.disabled = false;
    cmpRunBtn.textContent = '비교 실행';
}

cmpRunBtn.addEventListener('click', runComparisonTest);

// ========== Custom Pipeline ==========

const CP_STEPS = [
    { value: 'dino', label: 'DINO', group: '감지' },
    { value: 'mmdino', label: 'MM-DINO', group: '감지' },
    { value: 'gdino-base', label: 'DINO-Base', group: '감지' },
    { value: 'florence2', label: 'Florence-2', group: '감지' },
    { value: 'faceapi', label: 'face-api', group: '감지' },
    { value: 'crop', label: 'Crop', group: '전처리' },
    { value: 'vitpose', label: 'ViTPose', group: '포즈' },
    { value: 'sam2', label: 'SAM2', group: '세그먼트' },
    { value: 'vitmatte', label: 'ViTMatte', group: '매팅' },
    { value: 'mematte', label: 'MEMatte', group: '매팅' },
    { value: 'diffmatte', label: 'DiffMatte', group: '매팅' },
    { value: 'birefnet-matting', label: 'BiRefNet-HR', group: '매팅' },
    { value: 'matting', label: 'Matting', group: 'Alpha 매팅' },
    { value: 'hr-matting-alpha', label: 'HR-Matting-A', group: 'Alpha 매팅' },
    { value: 'dynamic-matting', label: 'Dynamic-Matting', group: 'Alpha 매팅' },
    { value: 'portrait', label: 'Portrait', group: '배경 제거' },
    { value: 'hr', label: 'HR', group: '배경 제거' },
    { value: 'hr-matting', label: 'HR-Matting', group: '배경 제거' },
    { value: 'dynamic', label: 'Dynamic', group: '배경 제거' },
    { value: 'rmbg2', label: 'RMBG2', group: '배경 제거' },
    { value: 'ben2', label: 'BEN2', group: '배경 제거' },
    { value: 'removebg', label: 'remove.bg', group: '배경 제거' },
];

const cpCheck = document.getElementById('cp-check');
const cpBuilder = document.getElementById('cp-builder');
const cpChain = document.getElementById('cp-chain');
const cpAddBtn = document.getElementById('cp-add-btn');
const cpRunBtn = document.getElementById('cp-run-btn');

function getStepLabel(value) {
    const s = CP_STEPS.find(s => s.value === value);
    return s ? s.label : value;
}

const BG_MODELS = PipelineCore.BG_MODELS;
const isBgModel = PipelineCore.isBgModel;

function addCPStep(value, prompt, params) {
    const step = document.createElement('div');
    step.className = 'cp-step';

    const num = document.createElement('span');
    num.className = 'cp-step-num';
    step.appendChild(num);

    const select = document.createElement('select');
    let lastGroup = '';
    for (const s of CP_STEPS) {
        if (s.group !== lastGroup) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = s.group;
            for (const gs of CP_STEPS.filter(x => x.group === s.group)) {
                const opt = document.createElement('option');
                opt.value = gs.value;
                opt.textContent = gs.label;
                optgroup.appendChild(opt);
            }
            select.appendChild(optgroup);
            lastGroup = s.group;
        }
    }
    if (value) select.value = value;

    // DINO 프롬프트 + threshold 입력
    const dinoParams = document.createElement('div');
    dinoParams.className = 'cp-step-params';
    dinoParams.style.display = (value === 'dino' || value === 'mmdino' || value === 'gdino-base') ? '' : 'none';
    dinoParams.dataset.group = 'dino';

    const promptInput = document.createElement('input');
    promptInput.type = 'text';
    promptInput.className = 'cp-step-prompt';
    promptInput.placeholder = 'person';
    promptInput.value = (prompt) || '';
    promptInput.title = 'DINO 텍스트 프롬프트 (마침표로 구분)';
    promptInput.addEventListener('input', () => saveCPToLocalStorage());
    dinoParams.appendChild(promptInput);

    // 도움말 버튼
    const helpBtn = document.createElement('button');
    helpBtn.type = 'button';
    helpBtn.className = 'cp-help-btn';
    helpBtn.textContent = '?';
    helpBtn.innerHTML = `?<div class="cp-help-popup">
<h4>DINO 프롬프트 가이드</h4>
마침표( . )로 여러 대상을 구분합니다.<br>
예: <code>person</code> = "person" 감지, <code>child . person</code> = "child" 또는 "person" 감지<br>
<span style="color:#888;font-size:11px">태그를 클릭하면 프롬프트에 추가됩니다</span>

<h4>사람</h4>
<span class="tag good cp-tag-insert">person</span>
<span class="tag good cp-tag-insert">man</span>
<span class="tag good cp-tag-insert">woman</span>
<span class="tag good cp-tag-insert">boy</span>
<span class="tag good cp-tag-insert">girl</span>
<span class="tag good cp-tag-insert">baby</span>
<span class="tag warn cp-tag-insert">child</span>

<h4>동물</h4>
<span class="tag good cp-tag-insert">cat</span>
<span class="tag good cp-tag-insert">dog</span>
<span class="tag good cp-tag-insert">bird</span>
<span class="tag good cp-tag-insert">horse</span>
<span class="tag good cp-tag-insert">bear</span>
<span class="tag good cp-tag-insert">teddy bear</span>

<h4>물건</h4>
<span class="tag good cp-tag-insert">toy</span>
<span class="tag good cp-tag-insert">doll</span>
<span class="tag good cp-tag-insert">ball</span>
<span class="tag good cp-tag-insert">bag</span>
<span class="tag good cp-tag-insert">shoe</span>
<span class="tag good cp-tag-insert">hat</span>
<span class="tag good cp-tag-insert">bottle</span>
<span class="tag good cp-tag-insert">cup</span>
<span class="tag good cp-tag-insert">book</span>
<span class="tag good cp-tag-insert">phone</span>

<h4>가구/기타</h4>
<span class="tag good cp-tag-insert">chair</span>
<span class="tag good cp-tag-insert">table</span>
<span class="tag good cp-tag-insert">car</span>
<span class="tag good cp-tag-insert">bicycle</span>
<span class="tag good cp-tag-insert">tree</span>
<span class="tag good cp-tag-insert">flower</span>

<h4>TH (Threshold, 임계값)</h4>
DINO가 감지한 객체의 신뢰도 필터입니다.<br>
<code>TH 0.25</code> = 신뢰도 25% 이상만 결과에 포함<br>
<span class="tag good">높이면 (0.4~0.9)</span> 확실한 것만 감지, 누락 가능<br>
<span class="tag warn">낮추면 (0.05~0.2)</span> 더 많이 감지, 오탐 증가<br>
기본값 <code>0.25</code> 권장

<h4>모델별 차이</h4>
<span class="tag good">DINO</span> Grounding DINO-Tiny (48.4 AP)<br>
Swin-Tiny 백본. 가장 가볍고 빠름. 기본 선택.<br><br>
<span class="tag good">MM-DINO</span> MM-Grounding DINO-Tiny (50.6 AP)<br>
동일 Swin-Tiny 백본이지만 더 좋은 데이터로 학습.<br>
DINO 대비 <b>+2.2 AP</b>, 속도/VRAM 거의 동일. 공짜 업그레이드.<br><br>
<span class="tag good">DINO-Base</span> Grounding DINO-Base (52.5 AP)<br>
Swin-Base 백본. 가장 정확하지만 더 무겁고 느림.<br>
VRAM ~1.5배, 추론 ~2배 소요. 정밀 감지가 필요할 때.

<h4>학습 해상도</h4>
DINO / MM-DINO (Tiny): 짧은변 <code>480~800px</code>, 긴변 최대 <code>1333px</code><br>
DINO-Base: 동일 해상도 범위, 백본 <code>384×384</code> 사전학습<br>
백본(SwinT/SwinB) 사전학습: <code>224×224</code> / <code>384×384</code>

<div class="tip">
<span class="tag good" style="font-size:10px">초록</span> = 잘 감지됨
<span class="tag warn" style="font-size:10px">주황</span> = 약함 (단독 사용 시 감지 실패 가능)<br>
<code>child</code>는 단독으로 안 됨 → <code>child . person</code> 사용
</div>
</div>`;
    dinoParams.appendChild(helpBtn);

    // 태그 클릭 → 프롬프트 입력에 추가
    helpBtn.addEventListener('click', (e) => {
        const tag = e.target.closest('.cp-tag-insert');
        if (!tag) return;
        e.stopPropagation();
        const keyword = tag.textContent.trim();
        const cur = promptInput.value.trim();
        if (!cur) {
            promptInput.value = keyword;
        } else {
            // 이미 같은 키워드가 있으면 무시
            const existing = cur.split(/\s*\.\s*/);
            if (existing.includes(keyword)) return;
            promptInput.value = cur + ' . ' + keyword;
        }
        promptInput.dispatchEvent(new Event('input'));
        // 깜빡임 피드백
        tag.style.transition = 'transform 0.15s';
        tag.style.transform = 'scale(1.2)';
        setTimeout(() => { tag.style.transform = ''; }, 150);
    });

    const thLabel = document.createElement('label');
    thLabel.title = 'Threshold: 감지 신뢰도 임계값 (0.05~0.9)\n낮을수록 더 많이 감지하지만 오탐이 늘어납니다\n기본값 0.25';
    thLabel.textContent = 'TH';
    const thInput = document.createElement('input');
    thInput.type = 'number';
    thInput.min = 0.05; thInput.max = 0.9; thInput.step = 0.05;
    thInput.value = (params && params.threshold != null) ? params.threshold : 0.25;
    thInput.title = thLabel.title;
    thInput.addEventListener('input', () => saveCPToLocalStorage());
    thLabel.appendChild(thInput);
    dinoParams.appendChild(thLabel);

    // Florence-2 파라미터
    const florenceParams = document.createElement('div');
    florenceParams.className = 'cp-step-params';
    florenceParams.style.display = (value === 'florence2') ? '' : 'none';
    florenceParams.dataset.group = 'florence2';

    const f2TaskLabel = document.createElement('label');
    f2TaskLabel.textContent = 'Task';
    f2TaskLabel.title = 'Florence-2 태스크 모드';
    const f2TaskSelect = document.createElement('select');
    f2TaskSelect.className = 'cp-f2-task';
    f2TaskSelect.innerHTML = '<option value="od">OD (자동)</option><option value="grounding">Grounding</option>';
    if (params && params.task) f2TaskSelect.value = params.task;
    f2TaskSelect.addEventListener('change', () => {
        f2PromptWrap.style.display = (f2TaskSelect.value === 'grounding') ? '' : 'none';
        saveCPToLocalStorage();
    });
    f2TaskLabel.appendChild(f2TaskSelect);
    florenceParams.appendChild(f2TaskLabel);

    const f2PromptWrap = document.createElement('span');
    f2PromptWrap.style.display = (params && params.task === 'grounding') ? '' : 'none';
    const f2PromptInput = document.createElement('input');
    f2PromptInput.type = 'text';
    f2PromptInput.className = 'cp-step-prompt cp-f2-prompt';
    f2PromptInput.placeholder = 'a child';
    f2PromptInput.value = (params && params.f2Prompt) || '';
    f2PromptInput.title = 'Grounding 프롬프트 (자연어 설명)';
    f2PromptInput.addEventListener('input', () => saveCPToLocalStorage());
    f2PromptWrap.appendChild(f2PromptInput);
    florenceParams.appendChild(f2PromptWrap);

    const f2HelpBtn = document.createElement('button');
    f2HelpBtn.type = 'button';
    f2HelpBtn.className = 'cp-help-btn';
    f2HelpBtn.innerHTML = `?<div class="cp-help-popup">
<h4>Florence-2 모델</h4>
MS의 멀티태스크 비전 모델 (Florence-2-large-ft)<br>
DINO와 다른 접근: 텍스트 grounding 가능

<h4>OD (자동) 모드</h4>
전체 객체를 감지 후 person/child/human 라벨만 필터<br>
프롬프트 불필요, 자동 감지

<h4>Grounding 모드</h4>
자연어 설명으로 직접 감지<br>
예: <code>a child playing</code>, <code>a person standing</code>

<h4>특성</h4>
<span class="tag warn">confidence score 없음</span> (항상 1.0)<br>
<span class="tag good">텍스트 grounding 가능</span><br>
FP16 + SDPA attention, VRAM ~4GB
</div>`;
    florenceParams.appendChild(f2HelpBtn);

    // ViTMatte erode/dilate 파라미터
    const vitParams = document.createElement('div');
    vitParams.className = 'cp-step-params';
    vitParams.style.display = (value === 'vitmatte' || value === 'mematte' || value === 'diffmatte') ? '' : 'none';
    vitParams.dataset.group = 'vitmatte';

    const erodeLabel = document.createElement('label');
    erodeLabel.title = 'Erode: 확실한 전경(FG) 영역을 축소하는 크기 (1~50)\n값이 클수록 전경이 많이 줄어들어 경계가 보수적으로 처리됩니다\n기본값 10';
    erodeLabel.textContent = 'E';
    const erodeInput = document.createElement('input');
    erodeInput.type = 'number';
    erodeInput.min = 1; erodeInput.max = 50;
    erodeInput.value = (params && params.erode != null) ? params.erode : 10;
    erodeInput.title = erodeLabel.title;
    erodeInput.addEventListener('input', () => saveCPToLocalStorage());
    erodeLabel.appendChild(erodeInput);

    const dilateLabel = document.createElement('label');
    dilateLabel.title = 'Dilate: 경계 불확실(Unknown) 영역을 확장하는 크기 (1~100)\n값이 클수록 ViTMatte가 분석하는 경계 영역이 넓어집니다\n기본값 20';
    dilateLabel.textContent = 'D';
    const dilateInput = document.createElement('input');
    dilateInput.type = 'number';
    dilateInput.min = 1; dilateInput.max = 100;
    dilateInput.value = (params && params.dilate != null) ? params.dilate : 20;
    dilateInput.title = dilateLabel.title;
    dilateInput.addEventListener('input', () => saveCPToLocalStorage());
    dilateLabel.appendChild(dilateInput);

    vitParams.appendChild(erodeLabel);
    vitParams.appendChild(dilateLabel);

    const vitHelpBtn = document.createElement('button');
    vitHelpBtn.className = 'cp-help-btn';
    vitHelpBtn.type = 'button';
    vitHelpBtn.innerHTML = `?<div class="cp-help-popup">
<h4>Trimap 파라미터</h4>
마스크에서 <b>확실한 전경 / 불확실 경계 / 배경</b> 3구역을 생성합니다.

<h4>E (Erode) — 전경 축소</h4>
<span class="tag good">범위: 1~50</span> <span class="tag good">기본: 10</span><br>
마스크를 안쪽으로 깎아 <b>확실한 전경(FG)</b> 영역 결정<br>
값이 클수록 → 전경이 줄어들고 경계가 보수적으로 처리

<h4>D (Dilate) — 경계 확장</h4>
<span class="tag good">범위: 1~100</span> <span class="tag good">기본: 20</span><br>
마스크를 바깥으로 확장해 <b>불확실(Unknown)</b> 영역 결정<br>
값이 클수록 → 매팅 모델이 분석하는 경계가 넓어짐

<h4>학습 해상도</h4>
<span class="tag good">ViTMatte</span> <code>512×512</code> 크롭 학습 (추론 시 가변 해상도 지원)<br>
<span class="tag good">MEMatte</span> 풀 해상도 학습 (평균 ~5K×6K, 다운샘플링 없음)<br>
<span class="tag good">DiffMatte</span> <code>512×512</code> 크롭 학습 (추론 시 가변 해상도 지원)

<div class="tip">
<b>머리카락</b>이 잘 안 나오면 → <code>D를 30~50</code>으로 키워보세요<br>
<b>경계 노이즈</b>가 심하면 → <code>E를 15~20</code>으로 키워보세요
</div>
</div>`;
    vitParams.appendChild(vitHelpBtn);

    // Crop 파라미터: padding %
    const cropParams = document.createElement('div');
    cropParams.className = 'cp-step-params';
    cropParams.style.display = (value === 'crop') ? '' : 'none';
    cropParams.dataset.group = 'crop';

    const cropPadLabel = document.createElement('label');
    cropPadLabel.title = 'Padding: DINO bbox 주변 여백 (0~50%)\n값이 클수록 크롭 영역이 넓어집니다\n기본값 10%';
    cropPadLabel.textContent = 'Pad';
    const cropPadInput = document.createElement('input');
    cropPadInput.type = 'number';
    cropPadInput.min = 0; cropPadInput.max = 50; cropPadInput.step = 5;
    cropPadInput.value = (params && params.padding != null) ? params.padding : 10;
    cropPadInput.title = cropPadLabel.title;
    cropPadInput.style.width = '40px';
    cropPadInput.addEventListener('input', () => saveCPToLocalStorage());
    cropPadLabel.appendChild(cropPadInput);
    cropParams.appendChild(cropPadLabel);

    const cropHelpBtn = document.createElement('button');
    cropHelpBtn.className = 'cp-help-btn';
    cropHelpBtn.type = 'button';
    cropHelpBtn.innerHTML = `?<div class="cp-help-popup">
<h4>Crop — DINO bbox 크롭</h4>
DINO로 감지한 bbox 영역을 패딩과 함께 크롭합니다.<br>
크롭된 이미지가 다음 스텝(배경 제거 등)에 전달됩니다.

<h4>Pad — 여백 (%)</h4>
<span class="tag good">범위: 0~50</span> <span class="tag good">기본: 10</span><br>
bbox 너비/높이의 N%만큼 상하좌우 여백 추가<br>
<span class="tag good">10%</span> 대부분 적절<br>
<span class="tag warn">0%</span> bbox 꼭 맞게 (잘릴 수 있음)<br>
<span class="tag good">30~50%</span> 여유롭게 크롭

<div class="tip">
이 스텝 전에 <b>DINO</b> 또는 <b>face-api</b> 감지 단계가 필요합니다
</div>
</div>`;
    cropParams.appendChild(cropHelpBtn);

    // ViTPose 파라미터: 모델 선택 + min_score
    const vitposeParams = document.createElement('div');
    vitposeParams.className = 'cp-step-params';
    vitposeParams.style.display = (value === 'vitpose') ? '' : 'none';
    vitposeParams.dataset.group = 'vitpose';

    // 모델 선택 드롭다운
    const vpModelSelect = document.createElement('select');
    vpModelSelect.className = 'cp-vp-model';
    vpModelSelect.title = 'ViTPose 모델 선택\nBase: 86M, 77.0 AP (빠름)\nHuge: 657M, 81.1 AP (정밀)';
    for (const [val, label] of [['vitpose', 'Base'], ['vitpose-huge', 'Huge']]) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        vpModelSelect.appendChild(opt);
    }
    vpModelSelect.value = (params && params.vpModel) || 'vitpose';
    vpModelSelect.addEventListener('change', () => saveCPToLocalStorage());
    vitposeParams.appendChild(vpModelSelect);

    const minScoreLabel = document.createElement('label');
    minScoreLabel.title = 'Min Score: 최소 keypoint confidence (0.1~0.9)\n이 값 이상인 keypoints만 SAM2에 전달됩니다\n기본값 0.3';
    minScoreLabel.textContent = 'Score';
    const minScoreInput = document.createElement('input');
    minScoreInput.type = 'number';
    minScoreInput.min = 0.1; minScoreInput.max = 0.9; minScoreInput.step = 0.05;
    minScoreInput.value = (params && params.minScore != null) ? params.minScore : 0.3;
    minScoreInput.title = minScoreLabel.title;
    minScoreInput.addEventListener('input', () => saveCPToLocalStorage());
    minScoreLabel.appendChild(minScoreInput);
    vitposeParams.appendChild(minScoreLabel);

    const vitposeHelpBtn = document.createElement('button');
    vitposeHelpBtn.className = 'cp-help-btn';
    vitposeHelpBtn.type = 'button';
    vitposeHelpBtn.innerHTML = `?<div class="cp-help-popup">
<h4>ViTPose 파라미터</h4>
17개 COCO keypoints를 추출합니다.<br>
감지 단계(DINO/face-api) 없이도 전체 이미지 모드로 동작합니다.

<h4>모델</h4>
<span class="tag good">Base</span> 86M params, 77.0 AP — 빠름 (~20ms)<br>
<span class="tag good">Huge</span> 657M params, 81.1 AP — 정밀

<h4>Score — 최소 confidence</h4>
<span class="tag good">범위: 0.1~0.9</span> <span class="tag good">기본: 0.3</span><br>
이 값 이상인 keypoints만 SAM2 point prompt로 전달

<h4>학습 해상도</h4>
<span class="tag good">Base/Huge</span> <code>256×192</code> (4:3, 인체 바운딩 박스 크롭 기준)<br>
고해상도 옵션: <code>384×288</code> (성능↑, 연산량↑)

<div class="tip">
감지 단계가 있으면 → 아이/어른 구분하여 pos/neg points 분리<br>
감지 단계 없으면 → 전체 이미지에서 1인 포즈 추출 (모두 positive)
</div>
</div>`;
    vitposeParams.appendChild(vitposeHelpBtn);

    // SAM2 파라미터: combine (box+point 동시 사용)
    const sam2Params = document.createElement('div');
    sam2Params.className = 'cp-step-params';
    sam2Params.style.display = (value === 'sam2') ? '' : 'none';
    sam2Params.dataset.group = 'sam2';

    const combineLabel = document.createElement('label');
    combineLabel.title = 'Box+Point 동시 사용\nON: box로 영역 잡고 point로 사람 힌트 (가려진 몸 복원에 효과적)\nOFF: box만 사용 (기존 방식)';
    const combineCheck = document.createElement('input');
    combineCheck.type = 'checkbox';
    combineCheck.checked = (params && params.combine != null) ? params.combine : true;
    combineCheck.addEventListener('change', () => saveCPToLocalStorage());
    combineLabel.appendChild(combineCheck);
    combineLabel.appendChild(document.createTextNode(' Combine'));
    sam2Params.appendChild(combineLabel);

    const sam2HelpBtn = document.createElement('button');
    sam2HelpBtn.className = 'cp-help-btn';
    sam2HelpBtn.type = 'button';
    sam2HelpBtn.innerHTML = `?<div class="cp-help-popup">
<h4>SAM2 Prompt 모드</h4>

<h4>Combine (Box + Point)</h4>
<span class="tag good">기본: ON</span><br>
DINO의 <b>box</b>와 감지 단계의 <b>point</b>를 동시에 사용합니다.<br>
<span class="tag good">장점:</span> 물건을 들고 있거나 가려진 신체도 사람으로 인식<br>
<span class="tag warn">OFF 시:</span> box가 있으면 box만 사용 (기존 방식)

<h4>Point 소스</h4>
<span class="tag good">DINO만</span> → bbox 중심점 1개 (positive)<br>
<span class="tag good">face-api만</span> → 얼굴 중심점 (positive) + 어른 얼굴 (negative)<br>
<span class="tag good">ViTPose</span> → 관절 17개 (positive) + 어른 관절 (negative)

<div class="tip">
아이가 물건을 들고 있으면 → <b>Combine ON</b> + ViTPose 권장<br>
단순 배경이면 → OFF도 충분
</div>
</div>`;
    sam2Params.appendChild(sam2HelpBtn);

    // BG model: max_size
    const bgParams = document.createElement('div');
    bgParams.className = 'cp-step-params';
    bgParams.style.display = (isBgModel(value) || value === 'birefnet-matting') ? '' : 'none';
    bgParams.dataset.group = 'bg';

    // Size input (non-removebg models)
    const sizeLabel = document.createElement('label');
    sizeLabel.className = 'cp-bg-size';
    sizeLabel.title = 'Max Size: 처리 해상도 (512~9999)\n9999 = 원본 해상도 그대로 처리\n클수록 정밀하지만 느림\n기본값 1024';
    sizeLabel.textContent = 'Size';
    sizeLabel.style.display = (value === 'removebg') ? 'none' : '';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.min = 512; sizeInput.max = 9999; sizeInput.step = 128;
    sizeInput.value = (params && params.maxSize != null) ? params.maxSize : (value === 'birefnet-matting' ? 2048 : 1024);
    sizeInput.title = sizeLabel.title;
    sizeInput.style.width = '52px';
    sizeInput.addEventListener('input', () => saveCPToLocalStorage());
    sizeLabel.appendChild(sizeInput);

    // remove.bg size select (preview/full)
    const rbgLabel = document.createElement('label');
    rbgLabel.className = 'cp-rbg-size';
    rbgLabel.style.display = (value === 'removebg') ? '' : 'none';
    const rbgSelect = document.createElement('select');
    rbgSelect.className = 'cp-rbg-select';
    rbgSelect.innerHTML = '<option value="preview">Preview</option><option value="full">Full (원본)</option>';
    rbgSelect.value = (params && params.removebgSize) || 'preview';
    rbgSelect.addEventListener('change', () => saveCPToLocalStorage());
    rbgLabel.appendChild(rbgSelect);

    bgParams.appendChild(sizeLabel);
    bgParams.appendChild(rbgLabel);

    // SAM2 마스크 활용 체크박스 (birefnet-matting 전용)
    const maskLabel = document.createElement('label');
    maskLabel.className = 'cp-mask-guide';
    maskLabel.title = 'SAM2 마스크로 배경을 정리한 후 BiRefNet-HR에 전달\nSAM2 단계가 있어야 동작합니다';
    maskLabel.style.display = (value === 'birefnet-matting') ? '' : 'none';
    const maskCheck = document.createElement('input');
    maskCheck.type = 'checkbox';
    maskCheck.checked = (params && params.useMask != null) ? params.useMask : true;
    maskCheck.addEventListener('change', () => saveCPToLocalStorage());
    maskLabel.appendChild(maskCheck);
    maskLabel.appendChild(document.createTextNode(' 마스크'));
    bgParams.appendChild(maskLabel);

    const bgHelpBtn = document.createElement('button');
    bgHelpBtn.className = 'cp-help-btn';
    bgHelpBtn.type = 'button';
    bgHelpBtn.innerHTML = `?<div class="cp-help-popup">
<h4>배경 제거 파라미터</h4>

<h4>Size — 처리 해상도</h4>
<span class="tag good">범위: 512~9999</span> <span class="tag good">기본: 1024</span><br>
이미지의 긴 쪽을 이 크기로 리사이즈 후 처리<br>
<span class="tag good">9999</span> = 원본 해상도 그대로 (느리지만 정밀)

<h4>모델별 학습 해상도</h4>
<span class="tag good">Portrait (MODNet)</span> <code>512×512</code><br>
<span class="tag good">BEN2</span> <code>1024×1024</code><br>
<span class="tag good">BiRefNet</span> <code>1024×1024</code><br>
<span class="tag good">BiRefNet-matting</span> <code>1024×1024</code> (HR 버전은 <code>2048×2048</code>)<br>
<span class="tag good">SAM2</span> <code>1024×1024</code><br>
<span class="tag warn">remove.bg</span> 비공개 (API 서비스)

<div class="tip">
<b>빠른 결과</b>: <code>Size 1024</code> (대부분 모델의 학습 해상도)<br>
<b>고품질</b>: <code>Size 2048~9999</code> (학습 해상도 초과 시 효과 제한적)
</div>
</div>`;
    bgParams.appendChild(bgHelpBtn);

    // Show/hide params based on step type
    function updateParamsVisibility() {
        const v = select.value;
        dinoParams.style.display = (v === 'dino' || v === 'mmdino' || v === 'gdino-base') ? '' : 'none';
        florenceParams.style.display = (v === 'florence2') ? '' : 'none';
        cropParams.style.display = (v === 'crop') ? '' : 'none';
        vitposeParams.style.display = (v === 'vitpose') ? '' : 'none';
        sam2Params.style.display = (v === 'sam2') ? '' : 'none';
        vitParams.style.display = (v === 'vitmatte' || v === 'mematte' || v === 'diffmatte') ? '' : 'none';
        bgParams.style.display = (isBgModel(v) || v === 'birefnet-matting') ? '' : 'none';
        maskLabel.style.display = (v === 'birefnet-matting') ? '' : 'none';
        sizeLabel.style.display = (v === 'removebg') ? 'none' : '';
        rbgLabel.style.display = (v === 'removebg') ? '' : 'none';
    }

    select.addEventListener('change', () => {
        updateParamsVisibility();
        renderCPChain();
        saveCPPrefs();
    });
    step.appendChild(select);
    step.appendChild(dinoParams);
    step.appendChild(florenceParams);
    step.appendChild(cropParams);
    step.appendChild(vitposeParams);
    step.appendChild(sam2Params);
    step.appendChild(vitParams);
    step.appendChild(bgParams);

    const delBtn = document.createElement('button');
    delBtn.className = 'cp-step-del';
    delBtn.textContent = '×';
    delBtn.title = '삭제';
    delBtn.addEventListener('click', () => { step.remove(); renderCPChain(); saveCPPrefs(); });
    step.appendChild(delBtn);

    cpChain.appendChild(step);
    renderCPChain();
    saveCPPrefs();
}

function renderCPChain() {
    // Remove old arrows
    cpChain.querySelectorAll('.cp-arrow').forEach(a => a.remove());

    const steps = cpChain.querySelectorAll('.cp-step');
    steps.forEach((step, i) => {
        step.querySelector('.cp-step-num').textContent = i + 1;
        // Add arrow after each step except the last
        if (i < steps.length - 1) {
            const arrow = document.createElement('span');
            arrow.className = 'cp-arrow';
            arrow.textContent = '→';
            step.after(arrow);
        }
    });

    cpRunBtn.disabled = steps.length === 0 || !selectedFile;
}

function getCPSteps() {
    return [...cpChain.querySelectorAll('.cp-step > select')].map(s => s.value);
}

function getCPStepsWithPrompts() {
    return [...cpChain.querySelectorAll('.cp-step')].map(step => {
        const value = step.querySelector('select').value;
        const promptInput = step.querySelector('[data-group="dino"] .cp-step-prompt');
        const prompt = ((value === 'dino' || value === 'mmdino' || value === 'gdino-base') && promptInput) ? promptInput.value : '';
        let params = null;
        if (value === 'dino' || value === 'mmdino' || value === 'gdino-base') {
            const dinoDiv = step.querySelector('[data-group="dino"]');
            const thInput = dinoDiv?.querySelector('label input[type="number"]');
            params = { threshold: parseFloat(thInput?.value) || 0.25 };
        } else if (value === 'florence2') {
            const f2Div = step.querySelector('[data-group="florence2"]');
            const taskSel = f2Div?.querySelector('.cp-f2-task');
            const f2Prompt = f2Div?.querySelector('.cp-f2-prompt');
            params = { task: taskSel?.value || 'od', f2Prompt: f2Prompt?.value || '' };
        } else if (value === 'crop') {
            const cropDiv = step.querySelector('[data-group="crop"]');
            const padInput = cropDiv?.querySelector('input[type="number"]');
            params = { padding: parseInt(padInput?.value) || 10 };
        } else if (value === 'vitpose') {
            const vpDiv = step.querySelector('[data-group="vitpose"]');
            const scoreInput = vpDiv?.querySelector('input[type="number"]');
            const modelSel = vpDiv?.querySelector('.cp-vp-model');
            params = { minScore: parseFloat(scoreInput?.value) || 0.3, vpModel: modelSel?.value || 'vitpose' };
        } else if (value === 'sam2') {
            const sam2Div = step.querySelector('[data-group="sam2"]');
            const combineCheck = sam2Div?.querySelector('input[type="checkbox"]');
            params = { combine: combineCheck?.checked ?? true };
        } else if (value === 'vitmatte' || value === 'mematte' || value === 'diffmatte') {
            const vitDiv = step.querySelector('[data-group="vitmatte"]');
            const inputs = vitDiv?.querySelectorAll('input[type="number"]');
            params = { erode: parseInt(inputs?.[0]?.value) || 10, dilate: parseInt(inputs?.[1]?.value) || 20 };
        } else if (isBgModel(value) || value === 'birefnet-matting') {
            const bgDiv = step.querySelector('[data-group="bg"]');
            const sizeInput = bgDiv?.querySelector('.cp-bg-size input[type="number"]');
            params = { maxSize: parseInt(sizeInput?.value) || 1024 };
            if (value === 'removebg') {
                const rbgSel = bgDiv?.querySelector('.cp-rbg-select');
                params.removebgSize = rbgSel?.value || 'preview';
            }
            if (value === 'birefnet-matting') {
                const maskCheck = bgDiv?.querySelector('.cp-mask-guide input[type="checkbox"]');
                params.useMask = maskCheck?.checked ?? true;
            }
        }
        return { value, prompt, params };
    });
}

function getCPStepParams(index) {
    const steps = cpChain.querySelectorAll('.cp-step');
    if (index >= steps.length) return {};
    const step = steps[index];
    const value = step.querySelector('select').value;

    if (value === 'dino' || value === 'mmdino' || value === 'gdino-base') {
        const dinoDiv = step.querySelector('[data-group="dino"]');
        const promptInput = dinoDiv?.querySelector('.cp-step-prompt');
        const thInput = dinoDiv?.querySelector('label input[type="number"]');
        return {
            prompt: (promptInput?.value?.trim()) || 'person',
            threshold: parseFloat(thInput?.value) || 0.25,
        };
    }
    if (value === 'florence2') {
        const f2Div = step.querySelector('[data-group="florence2"]');
        const taskSel = f2Div?.querySelector('.cp-f2-task');
        const f2Prompt = f2Div?.querySelector('.cp-f2-prompt');
        return {
            task: taskSel?.value || 'od',
            f2Prompt: (f2Prompt?.value?.trim()) || 'a child',
        };
    }
    if (value === 'crop') {
        const cropDiv = step.querySelector('[data-group="crop"]');
        const padInput = cropDiv?.querySelector('input[type="number"]');
        return { padding: parseInt(padInput?.value) || 10 };
    }
    if (value === 'vitpose') {
        const vpDiv = step.querySelector('[data-group="vitpose"]');
        const scoreInput = vpDiv?.querySelector('input[type="number"]');
        const modelSel = vpDiv?.querySelector('.cp-vp-model');
        return {
            minScore: parseFloat(scoreInput?.value) || 0.3,
            vpModel: modelSel?.value || 'vitpose',
        };
    }
    if (value === 'sam2') {
        const sam2Div = step.querySelector('[data-group="sam2"]');
        const combineCheck = sam2Div?.querySelector('input[type="checkbox"]');
        return { combine: combineCheck?.checked ?? true };
    }
    if (value === 'vitmatte' || value === 'mematte' || value === 'diffmatte') {
        const vitDiv = step.querySelector('[data-group="vitmatte"]');
        const inputs = vitDiv?.querySelectorAll('input[type="number"]');
        return {
            erode: parseInt(inputs?.[0]?.value) || 10,
            dilate: parseInt(inputs?.[1]?.value) || 20,
        };
    }
    if (isBgModel(value) || value === 'birefnet-matting') {
        const bgDiv = step.querySelector('[data-group="bg"]');
        const sizeInput = bgDiv?.querySelector('.cp-bg-size input[type="number"]');
        const result = { maxSize: parseInt(sizeInput?.value) || 1024 };
        if (value === 'removebg') {
            const rbgSel = bgDiv?.querySelector('.cp-rbg-select');
            result.removebgSize = rbgSel?.value || 'preview';
        }
        if (value === 'birefnet-matting') {
            const maskCheck = bgDiv?.querySelector('.cp-mask-guide input[type="checkbox"]');
            result.useMask = maskCheck?.checked ?? true;
        }
        return result;
    }
    return {};
}


// Toggle visibility
cpCheck.addEventListener('change', () => {
    const on = cpCheck.checked;
    cpBuilder.classList.toggle('visible', on);
    // Hide/show conflicting controls
    document.querySelector('.sam2-toggle-bar').style.display = on ? 'none' : '';
    document.querySelector('.controls').style.display = on ? 'none' : '';
    // Hide old compare section when CP is on
    cmpSection.style.display = on ? 'none' : '';
    if (on && cpChain.children.length === 0) {
        // Default chain: DINO → ViTPose → SAM2 → ViTMatte
        addCPStep('dino');
        addCPStep('vitpose');
        addCPStep('sam2');
        addCPStep('vitmatte');
    }
    saveCPPrefs();
});

cpAddBtn.addEventListener('click', () => addCPStep('portrait'));

// --- Prefs ---
function saveCPPrefs() {
    savePrefs();
    saveCPToLocalStorage();
}

function saveCPToLocalStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        const prefs = raw ? JSON.parse(raw) : {};
        prefs.cpEnabled = cpCheck.checked;
        prefs.cpStepsData = getCPStepsWithPrompts();
        localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch (_) {}
}

function loadCPFromLocalStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.cpEnabled) {
            cpCheck.checked = true;
            cpBuilder.classList.add('visible');
            document.querySelector('.sam2-toggle-bar').style.display = 'none';
            document.querySelector('.controls').style.display = 'none';
            cmpSection.style.display = 'none';
        }
        // New format with prompts + params
        if (p.cpStepsData && Array.isArray(p.cpStepsData) && p.cpStepsData.length > 0) {
            for (const s of p.cpStepsData) addCPStep(s.value, s.prompt, s.params);
        // Legacy format (no prompts)
        } else if (p.cpSteps && Array.isArray(p.cpSteps) && p.cpSteps.length > 0) {
            for (const v of p.cpSteps) addCPStep(v);
        }
    } catch (_) {}
}

// Load on init
loadCPFromLocalStorage();

// ========== CPX: CP Compare ==========

const cpxSlots = [];
const cpxSection = document.getElementById('cpx-section');
const cpxSlotsEl = document.getElementById('cpx-slots');
const cpxCountEl = document.getElementById('cpx-count');
const cpxRunBtn = document.getElementById('cpx-run-btn');
const cpxClearBtn = document.getElementById('cpx-clear-btn');
const cpxAddBtn = document.getElementById('cpx-add-btn');
const cpxResultsEl = document.getElementById('cpx-results');
const cpxPipelinesEl = document.getElementById('cpx-pipelines');

function snapshotCurrentCP() {
    const stepsData = getCPStepsWithPrompts();
    if (stepsData.length === 0) return null;
    const name = stepsData.map(s => {
        let label = getStepLabel(s.value);
        if (s.prompt) label += `("${s.prompt}")`;
        return label;
    }).join(' → ');
    return { name, steps: stepsData };
}

function cpxSlotKey(slot) {
    return JSON.stringify(slot.steps.map(s => ({ v: s.value, p: s.prompt, params: s.params })));
}

function addCPXSlot() {
    const snap = snapshotCurrentCP();
    if (!snap) return;
    if (cpxSlots.length >= 6) return;

    const key = cpxSlotKey(snap);
    if (cpxSlots.some(s => cpxSlotKey(s) === key)) return;

    cpxSlots.push(snap);
    renderCPXSlots();
    saveCPXToLocalStorage();
}

function removeCPXSlot(index) {
    cpxSlots.splice(index, 1);
    renderCPXSlots();
    saveCPXToLocalStorage();
}

function clearCPXSlots() {
    cpxSlots.length = 0;
    renderCPXSlots();
    saveCPXToLocalStorage();
    cpxResultsEl.innerHTML = '';
    cpxResultsEl.classList.remove('visible');
    cpxPipelinesEl.innerHTML = '';
}

function renderCPXSlots() {
    cpxSlotsEl.innerHTML = '';
    cpxSlots.forEach((slot, idx) => {
        const el = document.createElement('div');
        el.className = 'cpx-slot';
        const badges = slot.steps.map(s => {
            let badge = getStepLabel(s.value);
            let paramStr = '';
            if (s.prompt) paramStr = `"${s.prompt}"`;
            else if (s.params) {
                const parts = [];
                if (s.params.threshold != null) parts.push(`TH${s.params.threshold}`);
                if (s.params.padding != null) parts.push(`pad${s.params.padding}%`);
                if (s.params.erode != null) parts.push(`E${s.params.erode}/D${s.params.dilate}`);
                if (s.params.removebgSize) parts.push(s.params.removebgSize);
                else if (s.params.maxSize != null) parts.push(`${s.params.maxSize}px`);
                if (s.params.combine != null) parts.push(s.params.combine ? 'combine' : 'box-only');
                if (s.params.minScore != null) parts.push(`min${s.params.minScore}`);
                if (s.params.vpModel && s.params.vpModel !== 'vitpose') parts.push(s.params.vpModel);
                if (s.params.useMask) parts.push('+mask');
                if (s.params.task) parts.push(s.params.task === 'grounding' ? `grounding` : 'od');
                if (s.params.f2Prompt) parts.push(`"${s.params.f2Prompt}"`);
                paramStr = parts.join(',');
            }
            return `<span class="cpx-slot-badge">${badge}${paramStr ? `<span class="cpx-param">${paramStr}</span>` : ''}</span>`;
        }).join(' → ');

        el.innerHTML = `
            <span class="cpx-slot-num">${idx + 1}</span>
            <div class="cpx-slot-chain">${badges}</div>
            <button class="cpx-slot-del" data-idx="${idx}">×</button>`;
        cpxSlotsEl.appendChild(el);
    });

    cpxCountEl.textContent = `${cpxSlots.length}개 슬롯`;
    cpxSection.style.display = cpxSlots.length > 0 ? '' : 'none';
    cpxRunBtn.disabled = cpxSlots.length < 2 || !selectedFile;
}

function saveCPXToLocalStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        const prefs = raw ? JSON.parse(raw) : {};
        prefs.cpxSlots = cpxSlots;
        localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch (_) {}
}

function loadCPXFromLocalStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.cpxSlots && Array.isArray(p.cpxSlots)) {
            cpxSlots.length = 0;
            for (const s of p.cpxSlots) cpxSlots.push(s);
            renderCPXSlots();
        }
    } catch (_) {}
}

loadCPXFromLocalStorage();

// Event listeners
cpxAddBtn.addEventListener('click', addCPXSlot);
cpxClearBtn.addEventListener('click', clearCPXSlots);
cpxSlotsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.cpx-slot-del');
    if (btn) removeCPXSlot(parseInt(btn.dataset.idx));
});

// --- CPX Execution Engine ---

function buildCPXPipelineGrid(slotIdx, steps) {
    const group = document.createElement('div');
    group.className = 'cpx-pipeline-group';
    group.innerHTML = `<div class="cpx-pipeline-label"><span class="cpx-pipeline-num">${slotIdx + 1}</span> 슬롯 ${slotIdx + 1}</div>`;

    const grid = document.createElement('div');
    grid.className = 'pipeline-grid';
    grid.style.gridTemplateColumns = steps.length <= 4 ? `repeat(${steps.length}, 1fr)` : 'repeat(3, 1fr)';

    steps.forEach((step, i) => {
        const prefix = `cpx-${slotIdx}-pipe`;
        const isLastBG = BG_MODELS.includes(step.value) && i === steps.length - 1;
        const card = document.createElement('div');
        card.className = 'pipeline-card';
        card.id = `${prefix}-${i}`;
        card.innerHTML = `
            <div class="card-header">
                <span class="step-num">${i + 1}</span>
                <span class="step-title">${getStepLabel(step.value)}</span>
                <span class="step-status" id="${prefix}-${i}-status"></span>
            </div>
            <div class="card-body${isLastBG ? ' checker-bg' : ''}">
                <div class="mini-spinner"></div>
                <canvas id="${prefix}-${i}-canvas"></canvas>
            </div>
            <div class="card-footer" id="${prefix}-${i}-info"></div>
            <div class="card-time" id="${prefix}-${i}-time"></div>`;
        grid.appendChild(card);
    });

    group.appendChild(grid);
    return group;
}

function createCPXCard(slot, slotIdx) {
    const card = document.createElement('div');
    card.className = 'cmp-card pending';
    card.dataset.slotIdx = slotIdx;

    const badges = slot.steps.map(s => {
        return `<span class="cmp-badge model">${getStepLabel(s.value)}</span>`;
    }).join('');

    card.innerHTML = `
        <div class="cmp-card-img"><div class="cmp-spinner"></div></div>
        <div class="cmp-card-meta">
            <div class="cmp-pipeline-badges">${badges}</div>
            <div class="cmp-metrics">대기 중...</div>
        </div>`;
    return card;
}

function updateCPXCard(card, result) {
    const imgDiv = card.querySelector('.cmp-card-img');
    const metrics = card.querySelector('.cmp-metrics');

    if (result.error) {
        card.className = 'cmp-card error';
        imgDiv.innerHTML = '<div class="cmp-error-icon">✕</div>';
        metrics.innerHTML = `<span class="cmp-error-msg">${result.error}</span>`;
        return;
    }

    card.className = 'cmp-card done';
    const img = document.createElement('img');
    img.src = result.imageUrl;
    imgDiv.innerHTML = '';
    imgDiv.appendChild(img);

    // Click to open modal
    imgDiv.addEventListener('click', () => {
        cmpModalImg.src = result.imageUrl;
        cmpModalInfo.textContent = result.summary;
        cmpModal.classList.add('visible');
    });

    const stepTimes = result.stepTimes.map((t, i) => `${getStepLabel(result.stepTypes[i])}: ${t}초`).join(' | ');
    metrics.innerHTML = `${result.width}×${result.height} | 총 ${result.totalTime}초<br><span style="color:#666;font-size:11px">${stepTimes}</span>`;
}

const DETECT_MODELS = PipelineCore.DETECT_MODELS;
const DETECT_MODEL_KEYS = PipelineCore.DETECT_MODEL_KEYS;

async function cpxPreFlightDino(pipelineContainer, origGrid, pipeTitle) {
    // Collect unique detect configs from all slots (model+prompt 조합별로 1회만 감지)
    const detectConfigs = new Map(); // "model|prompt" → { model, modelKey, prompt, threshold, task }
    for (const slot of cpxSlots) {
        for (const step of slot.steps) {
            if (!DETECT_MODELS.includes(step.value)) continue;
            const prompt = step.value === 'florence2'
                ? (step.params?.task === 'grounding' ? (step.params?.f2Prompt || 'a child') : '__od__')
                : (step.prompt || 'person');
            const cacheKey = `${step.value}|${prompt}`;
            if (!detectConfigs.has(cacheKey)) {
                detectConfigs.set(cacheKey, {
                    model: step.value,
                    modelKey: DETECT_MODEL_KEYS[step.value],
                    label: getStepLabel(step.value),
                    prompt,
                    threshold: step.params?.threshold || 0.25,
                    task: step.params?.task || 'od',
                });
            }
        }
    }
    if (detectConfigs.size === 0) return {};

    const dinoCache = {}; // "model|prompt" → selectedIdx

    let preflightIdx = 0;
    for (const [cacheKey, cfg] of detectConfigs) {
        const displayPrompt = cfg.prompt === '__od__' ? 'OD 자동' : cfg.prompt;
        pipeTitle.textContent = `${cfg.label} 사전 감지: "${displayPrompt}"`;
        origGrid.innerHTML = '';
        origGrid.style.gridTemplateColumns = '1fr';

        const cardId = `cpx-preflight-${preflightIdx++}`;
        const card = document.createElement('div');
        card.className = 'pipeline-card active';
        card.id = cardId;
        card.innerHTML = `
            <div class="card-header">
                <span class="step-num">★</span>
                <span class="step-title">${cfg.label}: "${displayPrompt}"</span>
                <span class="step-status" id="${cardId}-status">감지 중...</span>
            </div>
            <div class="card-body">
                <div class="mini-spinner"></div>
                <canvas id="${cardId}-canvas"></canvas>
            </div>
            <div class="card-footer" id="${cardId}-info"></div>
            <div class="card-time" id="${cardId}-time"></div>`;
        origGrid.appendChild(card);

        els.loadingText.textContent = `${cfg.label} 감지 중: "${displayPrompt}"`;

        // 서버 호출
        const formData = new FormData();
        formData.append('file', selectedFile);
        const urlParams = new URLSearchParams({ model: cfg.modelKey });
        if (cfg.model === 'florence2') {
            urlParams.set('task', cfg.task);
            if (cfg.task === 'grounding') urlParams.set('prompt', cfg.prompt);
        } else {
            urlParams.set('prompt', cfg.prompt);
            urlParams.set('threshold', cfg.threshold.toString());
        }
        const resp = await fetch(`${API_URL}/detect-child?${urlParams}`, { method: 'POST', body: formData });
        if (!resp.ok) {
            const errData = await resp.json().catch(() => null);
            throw new Error(extractErrorDetail(errData, `${cfg.label} 오류 (${resp.status})`));
        }

        const result = await resp.json();
        const boxes = result.detections || [];
        if (boxes.length < 1) throw new Error(`${cfg.label}: "${displayPrompt}"에 해당하는 객체가 감지되지 않았습니다.`);

        const sorted = [...boxes].sort((a, b) => {
            const aA = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
            const bA = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
            return aA - bA;
        });

        const canvas = document.getElementById(`${cardId}-canvas`);
        const img = await blobToImage(selectedFile);

        let selectedIdx;
        if (sorted.length === 1) {
            selectedIdx = 0;
            drawDinoBoxes(canvas, img, boxes, sorted[0]);
        } else {
            selectedIdx = await waitForPersonSelection(
                canvas, img, sorted, 0,
                {
                    setStep: (_i, s, t) => {
                        card.classList.remove('active', 'done', 'awaiting');
                        if (s) card.classList.add(s);
                        const el = document.getElementById(`${cardId}-status`);
                        if (el) el.textContent = t || '';
                    },
                    setInfo: (_i, t) => {
                        const el = document.getElementById(`${cardId}-info`);
                        if (el) el.textContent = t || '';
                    },
                }
            );
            drawDinoBoxes(canvas, img, boxes, sorted[selectedIdx]);
        }

        dinoCache[cacheKey] = selectedIdx;

        card.classList.remove('active');
        card.classList.add('done');
        const statusEl = document.getElementById(`${cardId}-status`);
        if (statusEl) statusEl.textContent = '선택 완료';
        const infoEl = document.getElementById(`${cardId}-info`);
        if (infoEl) infoEl.textContent = `${sorted.length}명 중 ${selectedIdx + 1}번째 선택`;

        showLoading();
    }

    return dinoCache;
}

async function runCPXComparison() {
    if (cpxSlots.length < 2 || !selectedFile) return;

    showLoading();
    hideError();

    const useOriginalRes = document.getElementById('cpx-original-check')?.checked || false;

    const startTime = performance.now();
    let timerInterval = setInterval(() => {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        els.loadingTime.textContent = `${elapsed}초 경과`;
    }, 100);

    // Setup results grid
    cpxResultsEl.innerHTML = '';
    cpxResultsEl.classList.add('visible');
    cpxPipelinesEl.innerHTML = '';

    const cards = cpxSlots.map((slot, idx) => {
        const card = createCPXCard(slot, idx);
        cpxResultsEl.appendChild(card);
        return card;
    });

    // Pipeline container
    const pipelineContainer = document.getElementById('sam2-pipeline');
    pipelineContainer.classList.add('visible');
    const pipeTitle = pipelineContainer.querySelector('.pipeline-title');
    const origGrid = pipelineContainer.querySelector('.pipeline-grid');

    try {
        // === Pre-flight: DINO person selection ===
        const dinoCache = await cpxPreFlightDino(pipelineContainer, origGrid, pipeTitle);

        // === Slot execution loop ===
        for (let slotIdx = 0; slotIdx < cpxSlots.length; slotIdx++) {
            const slot = cpxSlots[slotIdx];
            const steps = slot.steps;
            const card = cards[slotIdx];
            card.className = 'cmp-card running';

            els.loadingText.textContent = `슬롯 ${slotIdx + 1}/${cpxSlots.length} 실행 중...`;
            pipeTitle.textContent = `CP 비교 — 슬롯 ${slotIdx + 1}`;

            // Build mini pipeline grid in main pipeline area
            origGrid.innerHTML = '';
            origGrid.style.gridTemplateColumns = steps.length <= 4 ? `repeat(${steps.length}, 1fr)` : 'repeat(3, 1fr)';

            const prefix = `cpx-${slotIdx}-pipe`;
            steps.forEach((step, i) => {
                const isLastBG = BG_MODELS.includes(step.value) && i === steps.length - 1;
                const pCard = document.createElement('div');
                pCard.className = 'pipeline-card';
                pCard.id = `${prefix}-${i}`;
                pCard.innerHTML = `
                    <div class="card-header">
                        <span class="step-num">${i + 1}</span>
                        <span class="step-title">${getStepLabel(step.value)}</span>
                        <span class="step-status" id="${prefix}-${i}-status"></span>
                    </div>
                    <div class="card-body${isLastBG ? ' checker-bg' : ''}">
                        <div class="mini-spinner"></div>
                        <canvas id="${prefix}-${i}-canvas"></canvas>
                    </div>
                    <div class="card-footer" id="${prefix}-${i}-info"></div>
                    <div class="card-time" id="${prefix}-${i}-time"></div>`;
                origGrid.appendChild(pCard);
            });

            // Pipeline state (fresh per slot)
            const img = await blobToImage(selectedFile);
            const state = {
                originalFile: selectedFile,
                originalImage: img,
                detections: null,
                vitposeResults: null,
                sam2: null,
                fullMaskCanvas: null,
                resultImage: null,
                resultBlob: null,
            };

            const stepTimes = [];
            const stepTypes = [];
            const slotStart = performance.now();

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                setCPStepPrefixed(prefix, i, 'active', '처리 중...');

                // Build step params with overrides
                const stepParams = { ...(step.params || {}) };

                // Resolution override: BG models & birefnet-matting
                if (useOriginalRes && (isBgModel(step.value) || step.value === 'birefnet-matting')) {
                    if (step.value === 'removebg') {
                        stepParams.removebgSize = 'full';
                    } else {
                        stepParams.maxSize = Math.max(img.width, img.height);
                    }
                }

                // 감지 모델: use cached selection (model+prompt 조합으로 캐시 키)
                let dinoIdx = undefined;
                if (DETECT_MODELS.includes(step.value)) {
                    const cachePrompt = step.value === 'florence2'
                        ? (step.params?.task === 'grounding' ? (step.params?.f2Prompt || 'a child') : '__od__')
                        : (step.prompt || 'person');
                    const cacheKey = `${step.value}|${cachePrompt}`;
                    if (dinoCache[cacheKey] != null) dinoIdx = dinoCache[cacheKey];
                }

                const stepStart = performance.now();
                const stepResult = await executeCPStep(step.value, state, i, {
                    gridPrefix: prefix,
                    params: stepParams,
                    prompt: step.prompt || undefined,
                    skipInteraction: true,
                    dinoSelectedIdx: dinoIdx,
                });
                const stepTime = stepResult?.actualTime || ((performance.now() - stepStart) / 1000).toFixed(2);
                setCPStepPrefixed(prefix, i, 'done', `${stepTime}초`);
                stepTimes.push(stepTime);
                stepTypes.push(step.value);
            }

            const totalTime = ((performance.now() - slotStart) / 1000).toFixed(2);

            // Save pipeline grid snapshot
            const pipeSnap = buildCPXPipelineGrid(slotIdx, steps);
            const snapGrid = pipeSnap.querySelector('.pipeline-grid');
            snapGrid.innerHTML = origGrid.innerHTML;
            cpxPipelinesEl.appendChild(pipeSnap);

            // Update result card
            if (state.resultImage) {
                const canvas = document.createElement('canvas');
                canvas.width = state.resultImage.width;
                canvas.height = state.resultImage.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(state.resultImage, 0, 0);
                const dataUrl = canvas.toDataURL('image/png');

                const summary = slot.steps.map(s => getStepLabel(s.value)).join(' → ') + ` | ${totalTime}초`;
                updateCPXCard(card, {
                    imageUrl: dataUrl,
                    width: state.resultImage.width,
                    height: state.resultImage.height,
                    totalTime,
                    stepTimes,
                    stepTypes,
                    summary,
                });
            } else {
                updateCPXCard(card, { error: '결과 이미지 없음' });
            }
        }
    } catch (err) {
        showError(err.message || String(err));
    } finally {
        clearInterval(timerInterval);
        hideLoading();
        pipeTitle.textContent = 'CP 비교 완료';
    }
}

cpxRunBtn.addEventListener('click', () => {
    if (selectedFile && cpxSlots.length >= 2) runCPXComparison();
});

// --- Dynamic Pipeline Grid ---

function buildCPPipelineGrid(steps) {
    const pipeline = document.getElementById('sam2-pipeline');
    pipeline.classList.add('visible');
    const titleEl = pipeline.querySelector('.pipeline-title');
    titleEl.textContent = '커스텀 파이프라인 진행';

    const grid = pipeline.querySelector('.pipeline-grid');
    grid.innerHTML = '';
    grid.classList.remove('six-steps');
    grid.style.gridTemplateColumns =
        steps.length <= 4 ? `repeat(${steps.length}, 1fr)` : 'repeat(3, 1fr)';

    steps.forEach((step, i) => {
        const card = document.createElement('div');
        card.className = 'pipeline-card';
        card.id = `cp-pipe-${i}`;
        const isLastBG = BG_MODELS.includes(step) && i === steps.length - 1;
        card.innerHTML = `
            <div class="card-header">
                <span class="step-num">${i + 1}</span>
                <span class="step-title">${getStepLabel(step)}</span>
                <span class="step-status" id="cp-pipe-${i}-status"></span>
            </div>
            <div class="card-body${isLastBG ? ' checker-bg' : ''}">
                <div class="mini-spinner"></div>
                <canvas id="cp-pipe-${i}-canvas"></canvas>
            </div>
            <div class="card-footer" id="cp-pipe-${i}-info"></div>
            <div class="card-time" id="cp-pipe-${i}-time"></div>`;
        grid.appendChild(card);
    });
}

function setCPStepPrefixed(prefix, index, state, statusText) {
    const card = document.getElementById(`${prefix}-${index}`);
    if (!card) return;
    card.classList.remove('active', 'done', 'awaiting');
    if (state) card.classList.add(state);
    const el = document.getElementById(`${prefix}-${index}-status`);
    if (el) el.textContent = statusText || '';
    const timeEl = document.getElementById(`${prefix}-${index}-time`);
    if (timeEl) timeEl.textContent = (state === 'done' && statusText) ? statusText : '';
}

function setCPInfoPrefixed(prefix, index, text) {
    const el = document.getElementById(`${prefix}-${index}-info`);
    if (el) el.textContent = text || '';
}

function setCPStep(index, state, statusText) {
    setCPStepPrefixed('cp-pipe', index, state, statusText);
}

function setCPInfo(index, text) {
    setCPInfoPrefixed('cp-pipe', index, text);
}

// --- Pipeline Execution ---

async function runCustomPipeline() {
    if (!selectedFile) return;

    const steps = getCPSteps();
    if (steps.length === 0) return;

    // UI setup
    showLoading();
    hideError();
    resetResults();

    const startTime = performance.now();
    let timerInterval = setInterval(() => {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        els.loadingTime.textContent = `${elapsed}초 경과`;
    }, 100);

    try {
        buildCPPipelineGrid(steps);

        const img = await blobToImage(selectedFile);

        // Pipeline state
        const state = {
            originalFile: selectedFile,
            originalImage: img,
            detections: null,   // { childFace, adultFaces, dinoBbox }
            vitposeResults: null, // [{ keypoints: [[x,y],...], scores: [...], bbox }, ...] — child first
            sam2: null,         // { image, blob, cropX, cropY, cropW, cropH, score }
            fullMaskCanvas: null,
            resultImage: null,
            resultBlob: null,
        };

        // Execute steps sequentially
        for (let i = 0; i < steps.length; i++) {
            const stepType = steps[i];
            setCPStep(i, 'active', '처리 중...');
            els.loadingText.textContent = `${getStepLabel(stepType)} 처리 중...`;

            const stepStart = performance.now();
            const stepResult = await executeCPStep(stepType, state, i);
            const stepTime = stepResult?.actualTime || ((performance.now() - stepStart) / 1000).toFixed(2);

            setCPStep(i, 'done', `${stepTime}초`);
        }

        const totalElapsed = ((performance.now() - startTime) / 1000).toFixed(2);

        // Final result: use state.resultImage
        if (state.resultImage) {
            processedBlob = state.resultBlob;
            resultImage = state.resultImage;

            renderResult(resultImage);
            renderPreviews(resultImage);

            const pipelineDesc = steps.map(s => getStepLabel(s)).join(' → ');
            els.processingInfo.textContent =
                `${pipelineDesc} | ${resultImage.width}x${resultImage.height} | 전체: ${totalElapsed}초`;
            els.processingInfo.classList.add('visible');

            els.compareSection.classList.add('visible');
            els.previewSection.classList.add('visible');
            els.downloadSection.classList.add('visible');
        }

    } catch (err) {
        showError(err.message || String(err));
    } finally {
        clearInterval(timerInterval);
        hideLoading();
    }
}

function waitForPersonSelection(canvas, img, sortedDetections, stepIndex, opts = {}) {
    return new Promise((resolve) => {
        const origW = img.width, origH = img.height;
        const setStep = opts.setStep || ((i, s, t) => setCPStep(i, s, t));
        const setInfo = opts.setInfo || ((i, t) => setCPInfo(i, t));

        setStep(stepIndex, 'awaiting', '선택 대기');
        setInfo(stepIndex, `${sortedDetections.length}명 감지 — 대상 인물을 클릭하세요`);

        hideLoading();

        drawDinoBoxesSelectable(canvas, img, sortedDetections, -1);

        function toOrig(e) {
            const rect = canvas.getBoundingClientRect();
            return {
                ox: (e.clientX - rect.left) / rect.width * origW,
                oy: (e.clientY - rect.top) / rect.height * origH,
            };
        }

        function onMove(e) {
            const { ox, oy } = toOrig(e);
            const idx = findDinoBoxAtPoint(ox, oy, sortedDetections);
            canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
            drawDinoBoxesSelectable(canvas, img, sortedDetections, idx);
        }

        function onClick(e) {
            const { ox, oy } = toOrig(e);
            const idx = findDinoBoxAtPoint(ox, oy, sortedDetections);
            if (idx < 0) return;

            canvas.removeEventListener('mousemove', onMove);
            canvas.removeEventListener('click', onClick);
            canvas.removeEventListener('mouseleave', onLeave);
            canvas.style.cursor = '';

            showLoading();
            resolve(idx);
        }

        function onLeave() {
            drawDinoBoxesSelectable(canvas, img, sortedDetections, -1);
        }

        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('click', onClick);
        canvas.addEventListener('mouseleave', onLeave);
    });
}

async function executeCPStep(stepType, state, index, opts = {}) {
    const gridPrefix = opts.gridPrefix || 'cp-pipe';
    const canvas = document.getElementById(`${gridPrefix}-${index}-canvas`);

    return PipelineCore.executePipelineStep(stepType, state, {
        params: opts.params || getCPStepParams(index),
        prompt: opts.prompt,
        skipInteraction: opts.skipInteraction || false,
        dinoSelectedIdx: opts.dinoSelectedIdx,
        sam2Padding: parseInt(document.getElementById('sam2-padding-slider')?.value || '30'),
        callbacks: {
            canvas,
            setInfo: (text) => setCPInfoPrefixed(gridPrefix, index, text),
            setStep: (s, t) => setCPStepPrefixed(gridPrefix, index, s, t),
            onWaitForSelection: (img, dets) => waitForPersonSelection(
                canvas, img, dets, index,
                { setStep: (i, s, t) => setCPStepPrefixed(gridPrefix, i, s, t),
                  setInfo: (i, t) => setCPInfoPrefixed(gridPrefix, i, t) }
            ),
            onShowLoading: showLoading,
            onHideLoading: hideLoading,
            drawDinoBoxes,
            drawFaceBoxes,
            drawPoseKeypoints,
            drawMaskOverlay,
            drawSAM2Result,
            drawAlphaMatte,
            drawTrimapVisualization,
        },
    });
}

// --- Run button ---
cpRunBtn.addEventListener('click', () => {
    if (selectedFile) runCustomPipeline();
});

document.getElementById('cp-clear-btn').addEventListener('click', () => {
    resetResults();
    // CPX 결과도 초기화
    cpxResultsEl.innerHTML = '';
    cpxResultsEl.classList.remove('visible');
    cpxPipelinesEl.innerHTML = '';
});

// --- File change → update CP chain state ---
els.fileInput.addEventListener('change', () => { renderCPChain(); });
