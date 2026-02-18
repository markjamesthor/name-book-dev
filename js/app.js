/**
 * 몽비 테스트 - 메인 애플리케이션
 * 사진 업로드, 처리, 렌더링 관리
 */

import {
    CONSTANTS,
    BODY_PARTS,
    urlTracker,
    enableDrag,
    setupEraser,
    loadImage,
    resizeImageForUpload,
    checkServerConnection,
    fetchWithFailover,
    showToast,
    getServerSettings,
    saveServerSettings,
    resetServerSettings
} from './utils.js';

import { setupSmartEraser } from './smartEraser.js';

import {
    initPoseDetector,
    getPoseDetector,
    estimatePoses,
    createLegend,
    drawKeypointsWithNumbers,
    classifyPhoto,
    analyzeAndPlaceRock,
    detectFaces,
    detectMainSubjects,
    getFootKeypointIndices
} from './pose.js';

// ========== 스토리 템플릿 (PoC 시각화용) ==========
const STORY_TEMPLATE = [
    { page: 1, mission: '전신 사진 필요', description: '숲속에서 모험을 시작하는 장면' },
    { page: 2, mission: '상반신 사진 필요', description: '놀라는 표정의 클로즈업' },
    { page: 3, mission: '전신 사진 필요', description: '친구를 만나는 장면' },
    { page: 4, mission: '자유 포즈', description: '자유롭게 뛰어노는 장면' },
    { page: 5, mission: '전신 사진 필요', description: '보물을 발견하는 장면' },
    { page: 6, mission: '상반신 사진 필요', description: '기뻐하는 표정' },
    { page: 7, mission: '자유 포즈', description: '해피엔딩 장면' }
];

// ========== DOM 요소 ==========
const elements = {
    mainWrapper: document.getElementById('main-wrapper'),
    loadingIndicator: document.getElementById('loading'),
    emptyState: document.getElementById('empty-state'),
    poseModelGroup: document.getElementById('pose-model-group'),
    smartCropBtn: document.getElementById('smart-crop-btn'),
    legendList: document.getElementById('legend-list'),
    scoreL: document.getElementById('score-l'),
    scoreR: document.getElementById('score-r'),
    noseXPct: document.getElementById('nose-x-pct'),
    kidAreaPct: document.getElementById('kid-area-pct'),
    postureResult: document.getElementById('posture-result'),
    postureAngleL: document.getElementById('posture-angle-l'),
    postureAngleR: document.getElementById('posture-angle-r'),
    markerBtn: document.getElementById('marker-btn'),
    eraserBtn: document.getElementById('eraser-btn'),
    smartEraserBtn: document.getElementById('smart-eraser-btn'),
    eraserSizeSlider: document.getElementById('eraser-size-slider'),
    eraserSizeVal: document.getElementById('eraser-size-val'),
    lightingIntensitySlider: document.getElementById('lighting-intensity-slider'),
    lightingIntensityVal: document.getElementById('lighting-intensity-val'),
    dashboard: document.getElementById('dashboard'),
    goodThumbnails: document.getElementById('good-thumbnails'),
    suspiciousThumbnails: document.getElementById('suspicious-thumbnails'),
    cutThumbnails: document.getElementById('cut-thumbnails'),
    multiThumbnails: document.getElementById('multi-thumbnails'),
    generateBtn: document.getElementById('generate-btn'),
    photoReplaceModal: document.getElementById('photo-replace-modal'),
    replaceThumbnailGrid: document.getElementById('replace-thumbnail-grid')
};

// ========== 상태 변수 ==========
const state = {
    isEraserMode: false,
    isSmartEraserMode: false,
    isSmartCropEnabled: false,
    isGridVisible: false,
    eraserSize: 20,
    modelLoaded: false,
    bgImageNaturalWidth: 1,
    bgImageNaturalHeight: 1,
    bgAspectRatio: 1,
    lightingSettings: {
        x: 70,
        y: 80,
        intensity: 75,
        size: 90
    },
    autoPlaceNoseX: 23, // 코 위치 자동 배치 기준 (스테이지 X %)
    analyzedPhotos: {
        good: [],
        suspicious: [],
        cut: [],
        multi: []
    }
};

// ========== 설정 저장/복원 (localStorage) ==========
const SETTINGS_KEY = 'monbiSettings';

function saveSettings() {
    const settings = {
        poseModel: document.querySelector('input[name="pose-model"]:checked')?.value || 'vitpose',
        bgServer: document.querySelector('input[name="bg-server"]:checked')?.value || 'mac',
        bgModel: document.querySelector('input[name="bg-model"]:checked')?.value || 'portrait',
        bgQuality: document.querySelector('input[name="bg-quality"]:checked')?.value || '1440',
        eraserSize: state.eraserSize,
        lightingIntensity: state.lightingSettings.intensity,
        smartCropEnabled: state.isSmartCropEnabled
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    console.log('💾 설정 저장됨:', settings);
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);

    // 기본값 정의
    const defaults = {
        poseModel: 'vitpose',
        bgServer: 'mac',
        bgModel: 'portrait',
        bgQuality: '1440',
        eraserSize: 20,
        lightingIntensity: 75,
        smartCropEnabled: false
    };

    // 저장된 값이 있으면 파싱, 없으면 기본값 사용
    let settings = defaults;
    if (saved) {
        try {
            settings = { ...defaults, ...JSON.parse(saved) };
            console.log('📂 설정 복원:', settings);
        } catch (e) {
            console.warn('설정 파싱 실패, 기본값 사용:', e);
        }
    } else {
        console.log('📂 저장된 설정 없음, 기본값 적용');
    }

    // 포즈 모델
    const poseRadio = document.querySelector(`input[name="pose-model"][value="${settings.poseModel}"]`);
    if (poseRadio) poseRadio.checked = true;

    // 배경 제거 서버
    const serverRadio = document.querySelector(`input[name="bg-server"][value="${settings.bgServer}"]`);
    if (serverRadio) serverRadio.checked = true;

    // 배경 제거 모델
    const modelRadio = document.querySelector(`input[name="bg-model"][value="${settings.bgModel}"]`);
    if (modelRadio) modelRadio.checked = true;

    // 배경 제거 품질
    const qualityRadio = document.querySelector(`input[name="bg-quality"][value="${settings.bgQuality}"]`);
    if (qualityRadio) qualityRadio.checked = true;

    // 지우개 크기
    state.eraserSize = settings.eraserSize;
    elements.eraserSizeSlider.value = settings.eraserSize;
    elements.eraserSizeVal.textContent = settings.eraserSize;

    // 조명 강도
    state.lightingSettings.intensity = settings.lightingIntensity;
    elements.lightingIntensitySlider.value = settings.lightingIntensity;
    elements.lightingIntensityVal.textContent = settings.lightingIntensity;

    // 스마트 크롭
    if (settings.smartCropEnabled) {
        state.isSmartCropEnabled = true;
        elements.smartCropBtn.textContent = '크롭 ON';
        elements.smartCropBtn.classList.add('btn-active');
    }
}

// ========== 초기화 ==========
async function initSystem() {
    elements.loadingIndicator.style.display = 'block';

    try {
        // 배경 이미지 로드
        const bgImg = await loadImage('image_3.png');
        state.bgImageNaturalWidth = bgImg.naturalWidth;
        state.bgImageNaturalHeight = bgImg.naturalHeight;
        state.bgAspectRatio = state.bgImageNaturalWidth / state.bgImageNaturalHeight;

        // 빈 화면 그리드 초기화 (배경 비율 확정 후)
        initEmptyStateGrid();

        // AI 모델 로드
        elements.loadingIndicator.textContent = "GPU 초기화 중...";
        elements.loadingIndicator.textContent = "AI 모델 준비 중...";
        await initPoseDetector();

        state.modelLoaded = true;
        elements.loadingIndicator.style.display = 'none';
        console.log("System Ready");

        checkServerConnection();
    } catch (e) {
        console.error(e);
        alert("초기화 실패: " + e.message);
        elements.loadingIndicator.style.display = 'none';
    }
}

// ========== UI 제어 ==========
function toggleMarkers() {
    document.body.classList.toggle('show-markers');
    if (document.body.classList.contains('show-markers')) {
        elements.markerBtn.textContent = "마커 끄기";
        elements.markerBtn.classList.add('toggle-on');
        // 현재 선택된 포즈 모델에 따라 범례 업데이트
        const currentPoseModel = document.querySelector('input[name="pose-model"]:checked')?.value || 'blazepose';
        createLegend(elements.legendList, currentPoseModel);
    } else {
        elements.markerBtn.textContent = "마커 켜기";
        elements.markerBtn.classList.remove('toggle-on');
    }
}

// 포즈 모델 변경 시 범례 업데이트
function updateLegendForModel() {
    if (document.body.classList.contains('show-markers')) {
        const currentPoseModel = document.querySelector('input[name="pose-model"]:checked')?.value || 'blazepose';
        createLegend(elements.legendList, currentPoseModel);
    }
}

function toggleEraserMode() {
    // 스마트 지우개가 켜져 있으면 먼저 끄기
    if (state.isSmartEraserMode) {
        deactivateSmartEraser();
    }

    state.isEraserMode = !state.isEraserMode;
    if (state.isEraserMode) {
        elements.eraserBtn.textContent = "지우개 끄기";
        elements.eraserBtn.classList.add('active');
        document.getElementById('eraser-size-controls').style.display = '';
        document.querySelectorAll('.kid-container').forEach(el => {
            el.classList.remove('pointer-pass');
            el.classList.add('pointer-active');
            el.style.cursor = 'crosshair';
        });
    } else {
        elements.eraserBtn.textContent = "🧹 지우개";
        elements.eraserBtn.classList.remove('active');
        document.querySelectorAll('.kid-container').forEach(el => {
            el.classList.remove('pointer-active');
            el.classList.add('pointer-pass');
            el.style.cursor = 'grab';
        });
    }
}

// ========== 스마트 지우개 ==========
// 각 캔버스의 스마트 지우개 인스턴스를 저장
const smartEraserInstances = new Map();

function deactivateSmartEraser() {
    state.isSmartEraserMode = false;
    elements.smartEraserBtn.textContent = '✨ 스마트 지우개';
    elements.smartEraserBtn.classList.remove('smart-eraser-on');
    document.querySelectorAll('.kid-container').forEach(el => {
        el.classList.remove('smart-eraser-active');
        el.classList.remove('pointer-active');
        el.classList.add('pointer-pass');
        el.style.cursor = 'grab';
    });
    // 오버레이 클리어
    smartEraserInstances.forEach(instance => instance.clearOverlay());
}

function toggleSmartEraserMode() {
    // 일반 지우개가 켜져 있으면 먼저 끄기
    if (state.isEraserMode) {
        state.isEraserMode = false;
        elements.eraserBtn.textContent = '🧹 지우개';
        elements.eraserBtn.classList.remove('active');
    }

    state.isSmartEraserMode = !state.isSmartEraserMode;
    if (state.isSmartEraserMode) {
        elements.smartEraserBtn.textContent = '스마트 끄기';
        elements.smartEraserBtn.classList.add('smart-eraser-on');
        document.getElementById('eraser-size-controls').style.display = 'none';
        document.querySelectorAll('.kid-container').forEach(el => {
            el.classList.remove('pointer-pass');
            el.classList.add('pointer-active');
            el.classList.add('smart-eraser-active');
        });
        // 기존 캔버스들에 대해 재분석
        smartEraserInstances.forEach(instance => instance.reanalyze());
        showToast('✨ 스마트 지우개 ON: 잔여물 위에 호버하면 하이라이트, 클릭하면 삭제', 'info', 3000);
    } else {
        deactivateSmartEraser();
    }
}

/**
 * kid-canvas에 스마트 지우개용 오버레이 캔버스를 추가하고 이벤트를 설정
 */
function attachSmartEraser(canvas, kidWrapper, photoData) {
    const overlay = document.createElement('canvas');
    overlay.className = 'smart-eraser-overlay';
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    kidWrapper.insertBefore(overlay, canvas.nextSibling);

    const instance = setupSmartEraser(canvas, overlay, {
        getSmartEraserMode: () => state.isSmartEraserMode,
        poseOptions: photoData ? {
            keypoints: photoData.pose?.keypoints,
            originalWidth: photoData.originalWidth,
            originalHeight: photoData.originalHeight,
            cropInfo: photoData.cropInfo,
            serverCropInfo: photoData.serverCropInfo
        } : {}
    });
    smartEraserInstances.set(canvas, instance);
}

function toggleControlsBorder() {
    const btn = document.getElementById('controls-border-btn');
    document.body.classList.toggle('hide-controls-border');
    if (document.body.classList.contains('hide-controls-border')) {
        btn.textContent = "테두리 켜기";
        btn.classList.remove('btn-active');
    } else {
        btn.textContent = "테두리 끄기";
        btn.classList.add('btn-active');
    }
}

function toggleSmartCrop() {
    state.isSmartCropEnabled = !state.isSmartCropEnabled;
    const btn = elements.smartCropBtn;
    if (state.isSmartCropEnabled) {
        btn.textContent = "크롭 ON";
        btn.classList.add('btn-active');
        showToast('✂️ 스마트 크롭 활성화: 얼굴+포즈 기반 크롭 후 배경 제거', 'info', 3000);
    } else {
        btn.textContent = "크롭 OFF";
        btn.classList.remove('btn-active');
        showToast('📷 스마트 크롭 비활성화: 원본 사진 그대로 배경 제거', 'info', 2000);
    }
    saveSettings();
}

// ========== 그리드 오버레이 ==========
function createGridOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'grid-overlay' + (state.isGridVisible ? ' visible' : '');

    for (let i = 1; i <= 9; i++) {
        const pct = i * 10;

        // 세로선
        const vLine = document.createElement('div');
        vLine.className = 'grid-line-v' + (pct === 50 ? ' grid-center' : '');
        vLine.style.left = `${pct}%`;
        overlay.appendChild(vLine);

        const vLabel = document.createElement('div');
        vLabel.className = 'grid-label grid-label-x';
        vLabel.style.left = `${pct}%`;
        vLabel.textContent = `${pct}%`;
        overlay.appendChild(vLabel);

        // 가로선
        const hLine = document.createElement('div');
        hLine.className = 'grid-line-h' + (pct === 50 ? ' grid-center' : '');
        hLine.style.top = `${pct}%`;
        overlay.appendChild(hLine);

        const hLabel = document.createElement('div');
        hLabel.className = 'grid-label grid-label-y';
        hLabel.style.top = `${pct}%`;
        hLabel.textContent = `${pct}%`;
        overlay.appendChild(hLabel);
    }

    return overlay;
}

function initEmptyStateGrid() {
    const container = document.getElementById('empty-state-grid');
    if (!container) return;

    function updateSize() {
        const parent = container.parentElement;
        const parentW = parent.clientWidth;
        const parentH = parent.clientHeight;
        const ratio = state.bgAspectRatio;

        let w, h;
        if (parentW / parentH > ratio) {
            // 부모가 더 넓음 → 높이 기준
            h = parentH;
            w = h * ratio;
        } else {
            // 부모가 더 높음 → 너비 기준
            w = parentW;
            h = w / ratio;
        }
        container.style.width = `${w}px`;
        container.style.height = `${h}px`;
    }

    updateSize();
    window.addEventListener('resize', updateSize);

    const grid = createGridOverlay();
    container.appendChild(grid);
}

function toggleGrid() {
    state.isGridVisible = !state.isGridVisible;
    const btn = document.getElementById('grid-btn');
    if (state.isGridVisible) {
        btn.textContent = '그리드 끄기';
        btn.classList.add('btn-active');
    } else {
        btn.textContent = '그리드 켜기';
        btn.classList.remove('btn-active');
    }
    document.querySelectorAll('.grid-overlay').forEach(g => {
        g.classList.toggle('visible', state.isGridVisible);
    });
}

// ========== 아이 면적 계산 ==========
function calcOpaqueArea(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let opaqueCount = 0;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 20) opaqueCount++; // alpha > 20
    }
    return opaqueCount;
}

function updateKidAreaDisplay(section) {
    const stage = section.querySelector('.scene-stage');
    const kidWrapper = stage?.querySelector('.kid-container');
    const canvas = kidWrapper?.querySelector('.kid-canvas');
    if (!canvas || !stage) {
        elements.kidAreaPct.innerText = '-';
        return;
    }

    const opaquePixels = calcOpaqueArea(canvas);
    const totalCanvasPixels = canvas.width * canvas.height;

    // 캔버스→스테이지 스케일 비율 (kid-container의 실제 렌더링 크기 기준)
    const kidRenderedWidth = kidWrapper.offsetWidth;
    const scale = parseFloat(kidWrapper.dataset.scale) || 1;
    const renderedWidthUnscaled = kidRenderedWidth / scale;
    const canvasToStageRatio = renderedWidthUnscaled / canvas.width;

    const opaqueStageArea = opaquePixels * canvasToStageRatio * canvasToStageRatio;
    const stageArea = stage.offsetWidth * stage.offsetHeight;
    const pct = (opaqueStageArea / stageArea) * 100;

    elements.kidAreaPct.innerText = `${pct.toFixed(1)}%`;
}

// ========== 자세 판단 (서기/앉기) ==========
function kneeAngle(hip, knee, ankle) {
    // 무릎 지점에서의 각도 (hip-knee-ankle)
    const ba = { x: hip.x - knee.x, y: hip.y - knee.y };
    const bc = { x: ankle.x - knee.x, y: ankle.y - knee.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
    const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
    if (magBA === 0 || magBC === 0) return null;
    const cosAngle = dot / (magBA * magBC);
    return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
}

function detectPosture(pose) {
    if (!pose?.keypoints) return { posture: '알 수 없음', leftAngle: null, rightAngle: null };

    const kp = pose.keypoints;
    const MIN_SCORE = 0.3;

    // 왼쪽 다리: 엉덩이(23) - 무릎(25) - 발목(27)
    const lHip = kp[23], lKnee = kp[25], lAnkle = kp[27];
    let leftAngle = null;
    if (lHip?.score >= MIN_SCORE && lKnee?.score >= MIN_SCORE && lAnkle?.score >= MIN_SCORE) {
        leftAngle = kneeAngle(lHip, lKnee, lAnkle);
    }

    // 오른쪽 다리: 엉덩이(24) - 무릎(26) - 발목(28)
    const rHip = kp[24], rKnee = kp[26], rAnkle = kp[28];
    let rightAngle = null;
    if (rHip?.score >= MIN_SCORE && rKnee?.score >= MIN_SCORE && rAnkle?.score >= MIN_SCORE) {
        rightAngle = kneeAngle(rHip, rKnee, rAnkle);
    }

    // 유효한 각도로 판단
    const angles = [leftAngle, rightAngle].filter(a => a !== null);
    if (angles.length === 0) return { posture: '알 수 없음', leftAngle, rightAngle };

    const minAngle = Math.min(...angles);

    let posture;
    if (minAngle < 120) {
        posture = '앉은 자세';
    } else if (minAngle < 150) {
        posture = '애매함';
    } else {
        posture = '서 있는 자세';
    }

    return { posture, leftAngle, rightAngle };
}

function updatePostureDisplay(section) {
    const photoName = section.dataset.photoName;
    // analyzedPhotos에서 해당 사진 찾기
    const allPhotos = [...state.analyzedPhotos.good, ...state.analyzedPhotos.suspicious, ...state.analyzedPhotos.cut, ...state.analyzedPhotos.multi];
    const photoData = allPhotos.find(p => p.name === photoName);

    if (!photoData?.pose) {
        elements.postureResult.innerText = '-';
        elements.postureAngleL.innerText = '-';
        elements.postureAngleR.innerText = '-';
        return;
    }

    const result = detectPosture(photoData.pose);

    elements.postureResult.innerText = result.posture;
    elements.postureResult.style.color =
        result.posture === '서 있는 자세' ? '#4CAF50' :
        result.posture === '앉은 자세' ? '#FF9800' :
        result.posture === '애매함' ? '#FFC107' : '#aaa';

    elements.postureAngleL.innerText = result.leftAngle !== null ? `${result.leftAngle.toFixed(0)}°` : '-';
    elements.postureAngleR.innerText = result.rightAngle !== null ? `${result.rightAngle.toFixed(0)}°` : '-';
}

function updateConfidenceDisplay(lScore, rScore) {
    const lVal = (lScore || 0).toFixed(2);
    const rVal = (rScore || 0).toFixed(2);
    elements.scoreL.innerText = lVal;
    elements.scoreR.innerText = rVal;
    elements.scoreL.className = 'score-val ' + (lScore > CONSTANTS.MIN_CONFIDENCE ? 'score-pass' : 'score-fail');
    elements.scoreR.className = 'score-val ' + (rScore > CONSTANTS.MIN_CONFIDENCE ? 'score-pass' : 'score-fail');
}

// 코 위치 기준 자동 배치
function autoPlaceByNose(kidWrapper, pose, stageW) {
    if (!pose || !pose.keypoints || !pose.keypoints[0]) return;

    const nose = pose.keypoints[0]; // 0번: 코
    if (nose.score < 0.3) return; // 신뢰도 낮으면 스킵

    // 0번 코 마커 찾기
    const noseNumbers = kidWrapper.querySelectorAll('.pose-number');
    let noseMarker = null;
    for (const num of noseNumbers) {
        if (num.innerText === '0') {
            noseMarker = num;
            break;
        }
    }

    if (!noseMarker) return;

    // 코 마커의 kidWrapper 내 상대 위치 (%)
    const noseLeftPct = parseFloat(noseMarker.style.left) || 0;

    // kidWrapper의 현재 width (%)
    const kidWidthPct = parseFloat(kidWrapper.style.width) || 0;

    // 목표: 코가 스테이지의 autoPlaceNoseX% 위치에 오도록
    // 코의 스테이지 내 X = kidWrapper.left + (kidWrapper.width * noseLeftPct / 100) = targetX
    // 따라서 kidWrapper.left = targetX - (kidWrapper.width * noseLeftPct / 100)
    const targetNoseX = state.autoPlaceNoseX;
    const newKidLeftPct = targetNoseX - (kidWidthPct * noseLeftPct / 100);

    kidWrapper.style.left = `${newKidLeftPct}%`;
}

// 코(0번) 위치 실시간 표시
function updateOffsetDisplay(element, centroid, stageW, stageH) {
    // kid-container만 처리 (돌 레이어는 제외)
    if (!element.classList.contains('kid-container')) return;

    // 0번 코 마커 찾기
    const noseNumbers = element.querySelectorAll('.pose-number');
    let noseMarker = null;
    for (const num of noseNumbers) {
        if (num.innerText === '0') {
            noseMarker = num;
            break;
        }
    }

    if (!noseMarker) {
        elements.noseXPct.innerText = '-';
        return;
    }

    // kidWrapper의 스테이지 내 위치 (%)
    const kidLeftPct = parseFloat(element.style.left) || 0;
    const kidWidthPct = parseFloat(element.style.width) || 0;

    // 코 마커의 kidWrapper 내 상대 위치 (%)
    const noseLeftPct = parseFloat(noseMarker.style.left) || 0;

    // 스테이지 기준 코의 절대 X 위치 (%)
    // = kidWrapper의 left + (kidWrapper의 width * 코의 상대위치 / 100)
    const noseAbsoluteXPct = kidLeftPct + (kidWidthPct * noseLeftPct / 100);

    // UI 업데이트
    elements.noseXPct.innerText = `${noseAbsoluteXPct.toFixed(1)}%`;
}

// ========== 스마트 크롭 (얼굴+포즈 기반) ==========
/**
 * 포즈 키포인트와 얼굴 감지 결과를 기반으로 아이만 크롭
 * @param {File} file - 원본 이미지 파일
 * @param {Object} pose - BlazePose 감지 결과
 * @param {Array} faces - face-api.js 감지 결과
 * @param {number} paddingRatio - 패딩 비율 (기본 0.2 = 20%)
 * @returns {Promise<{file: File, cropInfo: Object}>} 크롭된 파일과 크롭 정보
 */
async function smartCropImage(file, pose, faces, paddingRatio = 0.2) {
    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const imgW = img.naturalWidth;
            const imgH = img.naturalHeight;

            // 바운딩 박스 계산용 변수
            let minX = imgW, minY = imgH, maxX = 0, maxY = 0;

            // 1. 포즈 키포인트에서 바운딩 박스 계산
            if (pose && pose.keypoints) {
                for (const kp of pose.keypoints) {
                    if (kp.score > 0.3) { // 신뢰도 0.3 이상만 사용
                        minX = Math.min(minX, kp.x);
                        minY = Math.min(minY, kp.y);
                        maxX = Math.max(maxX, kp.x);
                        maxY = Math.max(maxY, kp.y);
                    }
                }
            }

            // 2. 얼굴 감지 결과에서 바운딩 박스 확장
            if (faces && faces.length > 0) {
                for (const face of faces) {
                    const box = face.box;
                    minX = Math.min(minX, box.x);
                    minY = Math.min(minY, box.y);
                    maxX = Math.max(maxX, box.x + box.width);
                    maxY = Math.max(maxY, box.y + box.height);
                }
            }

            // 유효한 바운딩 박스가 없으면 원본 반환
            if (minX >= maxX || minY >= maxY) {
                console.log('⚠️ 스마트 크롭: 유효한 영역 없음, 원본 사용');
                resolve({ file, cropInfo: null });
                return;
            }

            // 3. 패딩 추가
            const boxW = maxX - minX;
            const boxH = maxY - minY;
            const padX = boxW * paddingRatio;
            const padY = boxH * paddingRatio;

            const cropX = Math.max(0, Math.floor(minX - padX));
            const cropY = Math.max(0, Math.floor(minY - padY));
            const cropW = Math.min(imgW - cropX, Math.ceil(boxW + padX * 2));
            const cropH = Math.min(imgH - cropY, Math.ceil(boxH + padY * 2));

            console.log(`✂️ 스마트 크롭: ${imgW}x${imgH} → ${cropW}x${cropH} (영역: ${cropX},${cropY})`);

            // 4. 캔버스에 크롭
            const canvas = document.createElement('canvas');
            canvas.width = cropW;
            canvas.height = cropH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

            // 5. Blob으로 변환 후 File 생성
            canvas.toBlob((blob) => {
                const croppedFile = new File([blob], file.name, { type: 'image/png' });
                resolve({
                    file: croppedFile,
                    cropInfo: {
                        originalWidth: imgW,
                        originalHeight: imgH,
                        cropX, cropY, cropW, cropH
                    }
                });
            }, 'image/png', 1.0);
        };
        img.src = objectUrl;
    });
}

// edit-wrapper 크기 업데이트 (부모 스케일 보정 + 역스케일로 테두리/버튼 크기 유지)
function updateEditWrapperSize(editWrapper, container, padding = 40) {
    if (!editWrapper || !container) return;

    const tryUpdate = () => {
        const rect = container.getBoundingClientRect();
        const scale = parseFloat(container.dataset.scale) || 1;

        if (rect.width > 0 && rect.height > 0) {
            // 원하는 시각적 크기 = 컨테이너 시각적 크기 + padding
            const visualWidth = rect.width + padding;
            const visualHeight = rect.height + padding;

            // 부모 스케일 후 wrapper 시각적 크기가 visualWidth가 되려면:
            // CSS크기 * parentScale * (1/parentScale) = CSS크기 = visualWidth
            const cssWidth = visualWidth;
            const cssHeight = visualHeight;

            // 위치: 부모 스케일에 의해 확대되므로 미리 축소
            const cssOffset = (padding / 2) / scale;

            editWrapper.style.width = `${cssWidth}px`;
            editWrapper.style.height = `${cssHeight}px`;
            editWrapper.style.top = `-${cssOffset}px`;
            editWrapper.style.left = `-${cssOffset}px`;

            // 역스케일 적용 (테두리, 버튼 크기 일정하게 유지)
            editWrapper.style.transform = `scale(${1 / scale})`;
            editWrapper.style.transformOrigin = 'top left';

            return true;
        }
        return false;
    };

    // 즉시 시도 후, 실패하면 여러 번 재시도
    if (!tryUpdate()) {
        const attempts = [50, 100, 200, 500];
        attempts.forEach(delay => {
            setTimeout(tryUpdate, delay);
        });
    }
}

// ========== 조명 레이어 (Canvas 기반) ==========
// 조명 레이어를 Canvas에 그리기 (알파 채널 마스킹 적용)
function createLightingCanvas(sourceCanvas) {
    const lightingCanvas = document.createElement('canvas');
    lightingCanvas.className = 'lighting-layer';

    // 소스 캔버스의 내부 크기와 동일하게 설정
    lightingCanvas.width = sourceCanvas.width;
    lightingCanvas.height = sourceCanvas.height;

    console.log('💡 조명 레이어 생성:', {
        canvasSize: `${sourceCanvas.width}x${sourceCanvas.height}`,
        intensity: state.lightingSettings.intensity
    });

    updateLightingCanvas(lightingCanvas, sourceCanvas);
    return lightingCanvas;
}

function updateLightingCanvas(lightingCanvas, sourceCanvas) {
    if (!lightingCanvas || !sourceCanvas) return;

    const { x, y, intensity, size } = state.lightingSettings;
    const intensityRatio = intensity / 100;

    const ctx = lightingCanvas.getContext('2d');
    const w = lightingCanvas.width;
    const h = lightingCanvas.height;

    // 1. 원본 캔버스에서 알파 채널 가져오기
    const sourceCtx = sourceCanvas.getContext('2d');
    const sourceData = sourceCtx.getImageData(0, 0, w, h);
    const alphaData = sourceData.data;

    // 2. 조명 그라데이션 그리기
    ctx.clearRect(0, 0, w, h);

    const centerX = w * (x / 100);
    const centerY = h * (y / 100);
    const radius = Math.max(w, h) * (size / 100);

    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, `rgba(255, 150, 50, ${intensityRatio * 0.6})`);
    gradient.addColorStop(0.3, `rgba(255, 120, 30, ${intensityRatio * 0.4})`);
    gradient.addColorStop(0.55, `rgba(255, 100, 0, ${intensityRatio * 0.2})`);
    gradient.addColorStop(0.75, `rgba(255, 80, 0, ${intensityRatio * 0.08})`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // 3. 조명 이미지에 알파 채널 적용 (투명 부분 제외)
    const lightingData = ctx.getImageData(0, 0, w, h);
    const lightingPixels = lightingData.data;

    for (let i = 0; i < alphaData.length; i += 4) {
        const alpha = alphaData[i + 3]; // 원본 이미지의 알파값
        // 조명의 알파값과 원본 알파값 중 작은 값 사용
        lightingPixels[i + 3] = Math.min(lightingPixels[i + 3], alpha);
    }

    ctx.putImageData(lightingData, 0, 0);
}

function restoreLightingLayers() {
    document.querySelectorAll('.scene-stage').forEach(stage => {
        const kidWrapper = stage.querySelector('.kid-container');
        if (!kidWrapper) return;

        const sourceCanvas = kidWrapper.querySelector('.kid-canvas');
        if (!sourceCanvas) return;

        let lighting = kidWrapper.querySelector('.lighting-layer');

        // 기존 조명 레이어만 업데이트 (새로 생성하지 않음 - finishRenderingStage에서 생성)
        if (lighting && lighting.tagName === 'CANVAS') {
            updateLightingCanvas(lighting, sourceCanvas);
        }
    });
}

// ========== 사진 분석 ==========
// 서버 기반 ViTPose 포즈 감지
async function detectPoseWithViTPose(file, modelType) {
    const formData = new FormData();
    formData.append("file", file);

    const selectedServer = document.querySelector('input[name="bg-server"]:checked')?.value || 'windows';
    const { response } = await fetchWithFailover(`/detect-pose?model=${modelType}`, {
        method: "POST",
        body: formData
    }, selectedServer);

    const result = await response.json();

    if (!result.success) {
        throw new Error(result.detail || 'ViTPose 감지 실패');
    }

    // BlazePose 형식에 맞게 변환
    return [{
        keypoints: result.keypoints,
        score: result.keypoints.reduce((sum, kp) => sum + kp.score, 0) / result.keypoints.length
    }];
}

async function analyzePhoto(file) {
    const originalUrl = urlTracker.create(file);
    const originalImg = await loadImage(originalUrl);

    // 선택된 포즈 모델 확인
    const selectedPoseModel = document.querySelector('input[name="pose-model"]:checked')?.value || 'blazepose';
    let poses, pose;
    let actualModelUsed = selectedPoseModel; // 실제 사용된 모델 추적

    if (selectedPoseModel === 'blazepose') {
        // 브라우저 기반 BlazePose
        poses = await estimatePoses(originalImg);
        pose = poses[0];
    } else {
        // 서버 기반 ViTPose
        console.log(`🤖 ${selectedPoseModel} 서버 감지 요청...`);
        try {
            poses = await detectPoseWithViTPose(file, selectedPoseModel);
            pose = poses[0];
            console.log(`✅ ${selectedPoseModel} 감지 완료`);
        } catch (err) {
            console.error(`❌ ${selectedPoseModel} 실패, BlazePose로 폴백:`, err.message);
            showToast(`⚠️ ${selectedPoseModel} 실패, BlazePose 사용`, 'warning', 3000);
            poses = await estimatePoses(originalImg);
            pose = poses[0];
            actualModelUsed = 'blazepose'; // 폴백 시 실제 모델 업데이트
        }
    }

    // 얼굴 감지 (face-api.js) - 다중 인물 판별용
    const faces = await detectFaces(originalImg);
    const mainSubjects = detectMainSubjects(faces, originalImg.naturalWidth, originalImg.naturalHeight);

    console.log(`🔍 분석 완료 - 포즈모델: ${actualModelUsed}, 선택: ${selectedPoseModel}`);

    return {
        file: file,
        name: file.name,
        originalUrl: originalUrl,
        processedUrl: originalUrl,
        thumbnailUrl: originalUrl,
        processedImg: originalImg,
        pose: pose,
        poses: poses,
        poseModelType: actualModelUsed, // 실제 사용된 포즈 모델 타입 (blazepose, vitpose, vitpose-huge)
        faces: faces, // 감지된 모든 얼굴
        mainSubjects: mainSubjects, // 메인 인물들 (얼굴 크기 2% 이상)
        originalWidth: originalImg.naturalWidth,
        originalHeight: originalImg.naturalHeight
    };
}

// ========== 대시보드 ==========
function updateDashboard() {
    let currentIndex = 0;
    updateThumbnailGrid(elements.goodThumbnails, state.analyzedPhotos.good, currentIndex);
    currentIndex += state.analyzedPhotos.good.length;
    updateThumbnailGrid(elements.suspiciousThumbnails, state.analyzedPhotos.suspicious, currentIndex);
    currentIndex += state.analyzedPhotos.suspicious.length;
    updateThumbnailGrid(elements.cutThumbnails, state.analyzedPhotos.cut, currentIndex);
    currentIndex += state.analyzedPhotos.cut.length;
    updateThumbnailGrid(elements.multiThumbnails, state.analyzedPhotos.multi, currentIndex);

    document.querySelector('.category-good .thumbnail-count').textContent = `${state.analyzedPhotos.good.length}개`;
    document.querySelector('.category-suspicious .thumbnail-count').textContent = `${state.analyzedPhotos.suspicious.length}개`;
    document.querySelector('.category-cut .thumbnail-count').textContent = `${state.analyzedPhotos.cut.length}개`;
    document.querySelector('.category-multi .thumbnail-count').textContent = `${state.analyzedPhotos.multi.length}개`;

    const generatablePhotos = state.analyzedPhotos.good.length + state.analyzedPhotos.suspicious.length + state.analyzedPhotos.cut.length;
    elements.generateBtn.disabled = generatablePhotos === 0;
}

function updateThumbnailGrid(container, photos, startIndex = 0) {
    container.innerHTML = '';
    photos.forEach((photo, index) => {
        const item = document.createElement('div');
        item.className = 'thumbnail-item';
        item.dataset.index = index;
        item.dataset.category = photo.category;


        const img = document.createElement('img');
        img.src = photo.thumbnailUrl;
        img.alt = photo.name;

        const number = document.createElement('div');
        number.className = 'thumbnail-number';
        number.textContent = startIndex + index + 1;

        item.appendChild(img);
        item.appendChild(number);

        // BGQA 점수 및 경고 표시 (배경 제거 후에만)
        if (photo.bgqaScore !== undefined) {
            const scoreContainer = document.createElement('div');
            scoreContainer.className = 'bgqa-container';

            // 점수
            const scoreEl = document.createElement('div');
            scoreEl.className = 'bgqa-score';
            scoreEl.textContent = photo.bgqaScore.toFixed(0);
            // 점수에 따른 색상
            if (photo.bgqaScore >= 80) {
                scoreEl.classList.add('score-good');
            } else if (photo.bgqaScore >= 50) {
                scoreEl.classList.add('score-warning');
            } else {
                scoreEl.classList.add('score-bad');
            }
            scoreContainer.appendChild(scoreEl);

            // 경고 (있으면)
            if (photo.bgqaIssues && photo.bgqaIssues.length > 0) {
                const issueEl = document.createElement('div');
                issueEl.className = 'bgqa-issues';
                const issueLabels = {
                    'halo': '번짐',
                    'edge_quality': '경계',
                    'residue': '잔여물',
                    'color_outlier': '배경잔여',
                    'foreground_consistency': '물체잔여',
                    'face_coverage': '얼굴손실',
                    'mask_sanity': '마스크',
                    'holes': '구멍'
                };
                const issueText = photo.bgqaIssues
                    .map(i => issueLabels[i] || i)
                    .join(', ');
                issueEl.textContent = issueText;
                scoreContainer.appendChild(issueEl);
            }

            item.appendChild(scoreContainer);
        }

        // multi 카테고리이면 이유 표시
        if (photo.category === 'multi' && photo.multiReason) {
            const reasonEl = document.createElement('div');
            reasonEl.className = 'multi-reason';
            reasonEl.textContent = photo.multiReason;
            item.appendChild(reasonEl);
        }

        // multi 카테고리는 선택 불가 (0명 또는 2명 이상 감지)
        if (photo.category === 'multi') {
            item.classList.add('disabled');
        } else {
            item.addEventListener('click', () => {
                item.classList.toggle('selected');
            });
        }

        container.appendChild(item);
    });
}

function getAllPhotos() {
    return [...state.analyzedPhotos.good, ...state.analyzedPhotos.suspicious, ...state.analyzedPhotos.cut];
}

// ========== 사진 교체 ==========
function showReplaceModal(kidWrapper, stage, sectionElement) {
    elements.replaceThumbnailGrid.innerHTML = '';

    const currentPhotoName = kidWrapper.dataset.photoName || sectionElement.dataset.photoName;
    const allPhotos = getAllPhotos();
    const availablePhotos = allPhotos.filter(photo => photo.name !== currentPhotoName);

    if (availablePhotos.length === 0) {
        alert('교체할 다른 사진이 없습니다.');
        return;
    }

    availablePhotos.forEach((photo) => {
        const globalIndex = allPhotos.findIndex(p => p.name === photo.name) + 1;

        const item = document.createElement('div');
        item.className = 'replace-thumbnail-item';

        const img = document.createElement('img');
        img.src = photo.thumbnailUrl;
        img.alt = photo.name;

        const number = document.createElement('div');
        number.className = 'replace-thumbnail-number';
        number.textContent = globalIndex;

        // 카테고리 배지 표시
        const categoryBadge = document.createElement('div');
        categoryBadge.className = `replace-category-badge badge-${photo.category}`;
        categoryBadge.textContent = photo.category === 'good' ? '✅' : photo.category === 'suspicious' ? '⚠️' : '❌';
        item.appendChild(categoryBadge);

        item.appendChild(img);
        item.appendChild(number);
        item.onclick = async () => {
            // ========== 적극적 방어(Active Guardrail) 시스템 ==========
            if (photo.category === 'cut') {
                const confirmed = confirm(
                    '⚠️ [인쇄 품질 경고]\n\n' +
                    '신체 일부가 잘린 사진입니다.\n' +
                    '책으로 만들면 어색할 수 있습니다.\n\n' +
                    '그래도 진행할까요?'
                );
                if (!confirmed) {
                    console.log('🛡️ 가드레일 방어 성공: 사용자가 잘린 사진 교체를 취소함');
                    return; // 방어 성공 - 교체하지 않음
                }
                console.log('⚠️ 가드레일 경고 무시: 사용자가 잘린 사진으로 강제 교체');
            } else if (photo.category === 'suspicious') {
                const confirmed = confirm(
                    '⚠️ [화질 경고]\n\n' +
                    'AI가 보기에 화질이나 포즈가 불확실합니다.\n\n' +
                    '강제로 교체하시겠습니까?'
                );
                if (!confirmed) {
                    console.log('🛡️ 가드레일 방어 성공: 사용자가 의심 사진 교체를 취소함');
                    return; // 방어 성공 - 교체하지 않음
                }
                console.log('⚠️ 가드레일 경고 무시: 사용자가 의심 사진으로 강제 교체');
            }

            elements.photoReplaceModal.classList.remove('show');
            await replaceKidPhoto(kidWrapper, stage, sectionElement, photo);
        };

        elements.replaceThumbnailGrid.appendChild(item);
    });

    elements.photoReplaceModal.classList.add('show');
}

async function replaceKidPhoto(kidWrapper, stage, sectionElement, newPhotoData) {
    // Early return: 캐시 확인을 먼저 수행하여 불필요한 이미지 로드 방지
    if (!newPhotoData.cachedProcessedUrl || !newPhotoData.cachedProcessedImg) {
        alert('이 사진은 아직 생성되지 않았습니다. 먼저 생성하기 버튼을 눌러주세요.');
        return;
    }

    elements.loadingIndicator.style.display = 'block';
    elements.loadingIndicator.textContent = `사진 교체 중...`;

    try {
        const processedUrl = newPhotoData.cachedProcessedUrl;
        const processedImg = newPhotoData.cachedProcessedImg;
        const pose = newPhotoData.pose;

        const canvas = kidWrapper.querySelector('.kid-canvas');
        const oldLighting = kidWrapper.querySelector('.lighting-layer');
        const posePoints = kidWrapper.querySelectorAll('.pose-point, .pose-number');

        canvas.width = processedImg.naturalWidth;
        canvas.height = processedImg.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(processedImg, 0, 0);
        setupEraser(canvas, {
            getEraserMode: () => state.isEraserMode,
            getEraserSize: () => state.eraserSize
        });

        // 기존 스마트 지우개 오버레이 제거 및 재설정
        const oldOverlay = kidWrapper.querySelector('.smart-eraser-overlay');
        if (oldOverlay) oldOverlay.remove();
        if (smartEraserInstances.has(canvas)) {
            smartEraserInstances.get(canvas).cleanup();
            smartEraserInstances.delete(canvas);
        }
        attachSmartEraser(canvas, kidWrapper, newPhotoData);

        // 기존 조명 레이어 제거하고 새로 생성 (Canvas 기반)
        if (oldLighting) oldLighting.remove();
        const lighting = createLightingCanvas(canvas);
        kidWrapper.insertBefore(lighting, canvas.nextSibling);

        posePoints.forEach(point => point.remove());
        if (pose) {
            drawKeypointsWithNumbers(kidWrapper, pose, processedImg, newPhotoData.originalWidth, newPhotoData.originalHeight, newPhotoData.cropInfo, newPhotoData.serverCropInfo);
        }

        kidWrapper.dataset.processedUrl = processedUrl;
        sectionElement.dataset.originalImgUrl = newPhotoData.originalUrl;
        kidWrapper.dataset.photoName = newPhotoData.name;
        sectionElement.dataset.photoName = newPhotoData.name;

        if (pose) {
            // 모델에 따라 발 키포인트 인덱스 결정
            const poseModelType = newPhotoData.poseModelType || 'blazepose';
            const footIndices = getFootKeypointIndices(poseModelType);
            const lFoot = pose.keypoints[footIndices.left];
            const rFoot = pose.keypoints[footIndices.right];
            sectionElement.dataset.lScore = (lFoot?.score || 0).toFixed(2);
            sectionElement.dataset.rScore = (rFoot?.score || 0).toFixed(2);
        }

        // edit-wrapper 크기 업데이트
        const editWrapper = kidWrapper.querySelector('.kid-edit-wrapper');
        if (editWrapper) {
            updateEditWrapperSize(editWrapper, kidWrapper, 40);
        }

    } catch (err) {
        console.error('사진 교체 중 오류:', err);
        alert('사진 교체에 실패했습니다.');
    } finally {
        elements.loadingIndicator.style.display = 'none';
    }
}

// ========== 파일 처리 ==========
function cleanupPhotos() {
    const allPhotos = getAllPhotos();
    allPhotos.forEach(photo => {
        if (photo.originalUrl) {
            urlTracker.revoke(photo.originalUrl);
        }
        if (photo.cachedProcessedUrl && photo.cachedProcessedUrl !== photo.originalUrl) {
            urlTracker.revoke(photo.cachedProcessedUrl);
        }
    });
    console.log(`🧹 ${allPhotos.length}개 사진 URL 정리됨. 현재 추적 중: ${urlTracker.count}개`);
}

async function handleBatchUpload(files) {
    if (!state.modelLoaded) {
        alert("시스템 로딩 중입니다.");
        return;
    }

    document.body.classList.add('dashboard-active');
    document.body.classList.add('has-photos');

    cleanupPhotos();

    state.analyzedPhotos = {
        good: [],
        suspicious: [],
        cut: [],
        multi: []
    };

    for (let i = 0; i < files.length; i++) {
        elements.loadingIndicator.style.display = 'block';
        elements.loadingIndicator.textContent = `분석 중... (${i + 1}/${files.length})`;

        try {
            // HEIC → JPEG 변환 (아이폰 사진 Chrome 지원)
            let file = files[i];
            if (/\.heic$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif') {
                console.log(`🔄 HEIC 변환 중: ${file.name}`);
                elements.loadingIndicator.textContent = `HEIC 변환 중... (${i + 1}/${files.length})`;
                const jpegBlob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
                const convertedBlob = Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob;
                file = new File([convertedBlob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
                console.log(`✅ HEIC → JPEG 변환 완료: ${file.name}`);
            }
            const photoData = await analyzePhoto(file);

            // 0명 또는 두 명 이상이면 multi 카테고리로 분류
            let category;
            const faceCount = photoData.mainSubjects ? photoData.mainSubjects.length : 0;

            if (faceCount === 0) {
                // 얼굴 감지 실패 시 포즈 키포인트로 사람 존재 판단 (fallback)
                const pose = photoData.pose;
                const confidentKeypoints = pose?.keypoints?.filter(kp => kp.score > 0.3).length || 0;
                if (confidentKeypoints >= 5) {
                    // 키포인트 5개 이상이면 사람이 있다고 판단
                    console.log(`🦴 얼굴 미감지 → 포즈 fallback: 키포인트 ${confidentKeypoints}개 (사람 있음)`);
                    category = classifyPhoto(photoData);
                } else {
                    category = 'multi';
                    photoData.multiReason = '인물 감지 안됨';
                    console.log(`👥 얼굴 0명 + 포즈 키포인트 ${confidentKeypoints}개: ${files[i].name}`);
                }
            } else if (faceCount >= 2) {
                category = 'multi';
                photoData.multiReason = `${faceCount}명 감지됨`;
                console.log(`👥 얼굴 ${faceCount}명 감지: ${files[i].name}`);
                photoData.mainSubjects.forEach((s, idx) => {
                    console.log(`   - 얼굴${idx + 1}: 신뢰도=${(s.score * 100).toFixed(0)}%, 크기=${(s.areaRatio * 100).toFixed(1)}%`);
                });
            } else {
                category = classifyPhoto(photoData);
            }

            photoData.category = category;
            state.analyzedPhotos[category].push(photoData);

            updateDashboard();
        } catch (err) {
            console.error(err);
            alert(`사진 분석 실패: ${files[i].name}`);
        }
    }

    elements.loadingIndicator.style.display = 'none';
}

// 사진이 미션 요구사항에 적합한지 판단하는 함수
function evaluateMatchQuality(photoData, mission) {
    if (!photoData || !photoData.pose) return { match: '불확실', color: 'gray' };

    const pose = photoData.pose;
    const keypoints = pose.keypoints;
    const poseModelType = photoData.poseModelType || 'blazepose';

    // 모델에 따라 발 키포인트 인덱스 결정
    // BlazePose: 발가락(31, 32), ViTPose/COCO: 발목(27, 28)
    const footIndices = getFootKeypointIndices(poseModelType);
    const lFoot = keypoints[footIndices.left];
    const rFoot = keypoints[footIndices.right];
    const hasFullBody = (lFoot?.score > 0.5 || rFoot?.score > 0.5);

    // 어깨(11, 12) 신뢰도로 상반신 여부 판단
    const lShoulder = keypoints[11];
    const rShoulder = keypoints[12];
    const hasUpperBody = (lShoulder?.score > 0.7 && rShoulder?.score > 0.7);

    if (mission.includes('전신')) {
        if (hasFullBody) return { match: '적합', color: 'green' };
        if (hasUpperBody) return { match: '부분적합', color: 'orange' };
        return { match: '부적합', color: 'red' };
    } else if (mission.includes('상반신')) {
        if (hasUpperBody) return { match: '적합', color: 'green' };
        return { match: '부적합', color: 'red' };
    } else {
        // 자유 포즈
        return { match: '적합', color: 'green' };
    }
}

function createNewSection(pageIndex = 0, photoData = null) {
    const section = document.createElement('div');
    section.className = 'scene-section';
    section.dataset.lScore = 0;
    section.dataset.rScore = 0;

    const stage = document.createElement('div');
    stage.className = 'scene-stage';
    stage.style.backgroundImage = "url('image_3.png')";
    stage.style.aspectRatio = `${state.bgAspectRatio}`;

    // ========== 스토리 템플릿 매칭 시각화 ==========
    const template = STORY_TEMPLATE[pageIndex % STORY_TEMPLATE.length];
    const matchResult = evaluateMatchQuality(photoData, template.mission);

    const missionBadgeContainer = document.createElement('div');
    missionBadgeContainer.className = 'mission-badge-container';
    missionBadgeContainer.innerHTML = `
        <div class="mission-badge">
            <span class="mission-icon">📋</span>
            <span class="mission-text">[미션: ${template.mission}]</span>
        </div>
        <div class="match-badge match-${matchResult.color}">
            <span class="match-icon">${matchResult.color === 'green' ? '✅' : matchResult.color === 'orange' ? '⚠️' : matchResult.color === 'red' ? '❌' : '❓'}</span>
            <span class="match-text">[매칭: ${matchResult.match}]</span>
        </div>
        <div class="page-info">📖 ${pageIndex + 1}페이지: ${template.description}</div>
    `;
    stage.appendChild(missionBadgeContainer);

    // 그리드 오버레이
    stage.appendChild(createGridOverlay());

    section.appendChild(stage);
    return { section, stage };
}

// 배경 제거 요청을 미리 시작하는 함수 (Failover 적용 + 이미지 리사이즈)
async function startBackgroundRemoval(photoData) {
    if (photoData.cachedProcessedUrl && photoData.cachedProcessedImg) {
        // 이미 캐시됨
        return {
            processedUrl: photoData.cachedProcessedUrl,
            processedImg: photoData.cachedProcessedImg,
            server: 'cache'
        };
    }

    // 배경 제거 품질 설정 가져오기 (라디오 버튼)
    const quality = document.querySelector('input[name="bg-quality"]:checked')?.value || '1440';
    const isOriginal = quality === 'original';
    const qualityInt = isOriginal ? 9999 : parseInt(quality);

    // 스마트 크롭이 활성화되어 있으면 먼저 크롭
    let sourceFile = photoData.file;
    if (state.isSmartCropEnabled && (photoData.pose || photoData.faces)) {
        console.log('✂️ 스마트 크롭 모드 활성화');
        const cropResult = await smartCropImage(
            photoData.file,
            photoData.pose,
            photoData.faces,
            0.25 // 25% 패딩
        );
        if (cropResult.cropInfo) {
            sourceFile = cropResult.file;
            photoData.cropInfo = cropResult.cropInfo;
            showToast(`✂️ 크롭 완료: ${cropResult.cropInfo.cropW}x${cropResult.cropInfo.cropH}`, 'info', 2000);
        }
    }

    // 업로드 전 이미지 리사이즈 (원본이면 리사이즈 안함)
    const fileToUpload = isOriginal
        ? sourceFile
        : await resizeImageForUpload(sourceFile, qualityInt);

    // 배경 제거 요청 시작 (Failover 로직 적용)
    const formData = new FormData();
    formData.append("file", fileToUpload);

    // 선택된 서버 가져오기 (라디오 버튼: windows 또는 mac)
    const selectedServer = document.querySelector('input[name="bg-server"]:checked')?.value || 'windows';

    // 선택된 BiRefNet 모델 가져오기
    const selectedModel = document.querySelector('input[name="bg-model"]:checked')?.value || 'portrait';

    // 품질 및 모델 파라미터를 쿼리스트링으로 전달
    const { response, server } = await fetchWithFailover(`/remove-bg?max_size=${qualityInt}&model=${selectedModel}`, {
        method: "POST",
        body: formData
    }, selectedServer);

    // 서버에서 반환한 크롭 정보 읽기 (마커 좌표 보정용)
    const serverCropInfo = {
        originalWidth: parseInt(response.headers.get('X-Original-Width')) || 0,
        originalHeight: parseInt(response.headers.get('X-Original-Height')) || 0,
        cropX: parseInt(response.headers.get('X-Crop-X')) || 0,
        cropY: parseInt(response.headers.get('X-Crop-Y')) || 0,
        cropWidth: parseInt(response.headers.get('X-Crop-Width')) || 0,
        cropHeight: parseInt(response.headers.get('X-Crop-Height')) || 0,
    };

    // 서버 크롭 정보가 유효한지 확인
    if (serverCropInfo.cropWidth > 0) {
        photoData.serverCropInfo = serverCropInfo;
        console.log('📐 서버 크롭 정보:', serverCropInfo);
    }

    // BGQA 품질 점수 읽기
    const bgqaScore = parseFloat(response.headers.get('X-BGQA-Score')) || 0;
    const bgqaPassed = response.headers.get('X-BGQA-Passed') === 'true';
    const bgqaIssues = response.headers.get('X-BGQA-Issues') || '';
    photoData.bgqaScore = bgqaScore;
    photoData.bgqaPassed = bgqaPassed;
    photoData.bgqaIssues = bgqaIssues ? bgqaIssues.split(',') : [];
    console.log(`🎯 BGQA: ${bgqaScore}점 (${bgqaPassed ? 'PASS' : 'FAIL'})`);

    const blob = await response.blob();
    const processedUrl = urlTracker.create(blob);
    const processedImg = await loadImage(processedUrl);

    // 캐시 저장
    photoData.cachedProcessedUrl = processedUrl;
    photoData.cachedProcessedImg = processedImg;
    console.log(`📦 캐시 저장됨: ${photoData.name} (처리 서버: ${server === 'main' ? 'Windows/RTX' : 'Mac/Local'})`);

    return { processedUrl, processedImg, server };
}

// ========== 편집 히스토리 관리 ==========
const editHistory = new Map(); // photoName -> [{rotation, scale, left, top}]

function saveToHistory(kidWrapper, photoName) {
    if (!editHistory.has(photoName)) {
        editHistory.set(photoName, []);
    }
    const history = editHistory.get(photoName);
    const state = {
        rotation: parseFloat(kidWrapper.dataset.rotation || 0),
        scale: parseFloat(kidWrapper.dataset.scale || 1),
        left: kidWrapper.style.left,
        top: kidWrapper.style.top,
        width: kidWrapper.style.width
    };
    history.push(state);
    // 최대 20개 히스토리 유지
    if (history.length > 20) history.shift();
}

function undoFromHistory(kidWrapper, photoName) {
    const history = editHistory.get(photoName);
    if (!history || history.length < 2) {
        showToast('되돌릴 내용이 없습니다', 'info', 2000);
        return false;
    }
    // 현재 상태 제거
    history.pop();
    // 이전 상태 적용
    const prevState = history[history.length - 1];
    kidWrapper.dataset.rotation = prevState.rotation;
    kidWrapper.dataset.scale = prevState.scale;
    kidWrapper.style.left = prevState.left;
    kidWrapper.style.top = prevState.top;
    kidWrapper.style.width = prevState.width;
    kidWrapper.style.transform = `rotate(${prevState.rotation}deg) scale(${prevState.scale})`;

    // edit-wrapper 크기 업데이트
    const editWrapper = kidWrapper.querySelector('.kid-edit-wrapper');
    if (editWrapper) {
        updateEditWrapperSize(editWrapper, kidWrapper, 40);
    }

    showToast('되돌리기 완료', 'success', 1500);
    return true;
}

// 편집 컨트롤 UI 생성
function createEditControls(kidWrapper, stage, sectionElement, photoData) {
    const photoName = photoData?.name || 'unknown';

    // 초기 상태 저장
    kidWrapper.dataset.rotation = 0;
    kidWrapper.dataset.scale = 1;
    saveToHistory(kidWrapper, photoName);

    // 점선 테두리 래퍼
    const editWrapper = document.createElement('div');
    editWrapper.className = 'kid-edit-wrapper';

    // wrapper 크기 업데이트 함수
    const updateWrapper = () => {
        updateEditWrapperSize(editWrapper, kidWrapper, 40);
    };

    // 여러 시점에 크기 업데이트 시도
    updateWrapper();
    setTimeout(updateWrapper, 100);
    setTimeout(updateWrapper, 500);

    // ResizeObserver로 크기 변경 감지
    const resizeObserver = new ResizeObserver(updateWrapper);
    resizeObserver.observe(kidWrapper);

    // 윈도우 리사이즈 시에도 업데이트
    window.addEventListener('resize', updateWrapper);

    // 좌측 상단: 회전 버튼 (드래그)
    const rotateBtn = document.createElement('button');
    rotateBtn.className = 'kid-corner-btn top-left';
    rotateBtn.type = 'button';
    rotateBtn.title = '드래그: 회전';
    rotateBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
        <path d="M21 3v5h-5"/>
    </svg>`;

    // 회전 드래그 기능
    let isRotating = false;
    let rotateStartX, rotateStartY, rotateStartAngle, rotateCenterX, rotateCenterY;

    const onRotateStart = (e) => {
        e.stopPropagation();
        e.preventDefault();
        isRotating = true;

        const rect = kidWrapper.getBoundingClientRect();
        rotateCenterX = rect.left + rect.width / 2;
        rotateCenterY = rect.top + rect.height / 2;

        rotateStartX = e.clientX || e.touches?.[0]?.clientX;
        rotateStartY = e.clientY || e.touches?.[0]?.clientY;
        rotateStartAngle = parseFloat(kidWrapper.dataset.rotation || 0);

        document.addEventListener('mousemove', onRotateMove);
        document.addEventListener('mouseup', onRotateEnd);
        document.addEventListener('touchmove', onRotateMove, { passive: false });
        document.addEventListener('touchend', onRotateEnd);
    };

    const onRotateMove = (e) => {
        if (!isRotating) return;
        e.preventDefault();

        const clientX = e.clientX || e.touches?.[0]?.clientX;
        const clientY = e.clientY || e.touches?.[0]?.clientY;

        const startAngle = Math.atan2(rotateStartY - rotateCenterY, rotateStartX - rotateCenterX);
        const currentAngle = Math.atan2(clientY - rotateCenterY, clientX - rotateCenterX);
        const angleDiff = (currentAngle - startAngle) * (180 / Math.PI);
        const newRotation = rotateStartAngle + angleDiff;

        kidWrapper.dataset.rotation = newRotation;
        const currentScale = parseFloat(kidWrapper.dataset.scale) || 1;
        kidWrapper.style.transform = `rotate(${newRotation}deg) scale(${currentScale})`;
    };

    const onRotateEnd = () => {
        isRotating = false;
        document.removeEventListener('mousemove', onRotateMove);
        document.removeEventListener('mouseup', onRotateEnd);
        document.removeEventListener('touchmove', onRotateMove);
        document.removeEventListener('touchend', onRotateEnd);
    };

    rotateBtn.addEventListener('mousedown', onRotateStart);
    rotateBtn.addEventListener('touchstart', onRotateStart, { passive: false });
    editWrapper.appendChild(rotateBtn);

    // 우측 상단: 교체 버튼
    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'kid-corner-btn top-right';
    replaceBtn.type = 'button';
    replaceBtn.title = '사진 교체';
    replaceBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3L4 7l4 4"/>
        <path d="M4 7h16"/>
        <path d="M16 21l4-4-4-4"/>
        <path d="M20 17H4"/>
    </svg>`;
    replaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showReplaceModal(kidWrapper, stage, sectionElement);
    });
    editWrapper.appendChild(replaceBtn);

    // 좌측 하단: 삭제 버튼
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'kid-corner-btn bottom-left';
    deleteBtn.type = 'button';
    deleteBtn.title = '삭제';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/>
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    </svg>`;
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('이 사진을 삭제하시겠습니까?')) {
            sectionElement.remove();
            showToast('사진이 삭제되었습니다', 'success', 2000);
        }
    });
    editWrapper.appendChild(deleteBtn);

    // 우측 하단: 크기조절 버튼 (드래그)
    const resizeBtn = document.createElement('button');
    resizeBtn.className = 'kid-corner-btn bottom-right';
    resizeBtn.type = 'button';
    resizeBtn.title = '드래그: 크기조절';
    resizeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 3h6v6"/>
        <path d="M9 21H3v-6"/>
        <path d="M21 3l-7 7"/>
        <path d="M3 21l7-7"/>
    </svg>`;

    // 크기조절 드래그 기능 (대각선 방향: 오른쪽아래로 드래그 = 크게)
    let isResizing = false;
    let resizeStartX, resizeStartY, resizeStartScale;

    const onResizeStart = (e) => {
        e.stopPropagation();
        e.preventDefault();
        isResizing = true;

        resizeStartX = e.clientX || e.touches?.[0]?.clientX;
        resizeStartY = e.clientY || e.touches?.[0]?.clientY;
        resizeStartScale = parseFloat(kidWrapper.dataset.scale || 1);

        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeEnd);
        document.addEventListener('touchmove', onResizeMove, { passive: false });
        document.addEventListener('touchend', onResizeEnd);
    };

    const onResizeMove = (e) => {
        if (!isResizing) return;
        e.preventDefault();

        const clientX = e.clientX || e.touches?.[0]?.clientX;
        const clientY = e.clientY || e.touches?.[0]?.clientY;

        // 대각선 거리 계산 (오른쪽 아래로 드래그 = 크게)
        // 아이 이미지는 크기가 크므로 민감도를 낮춤 (300)
        const deltaX = clientX - resizeStartX;
        const deltaY = clientY - resizeStartY;
        const diagonal = (deltaX + deltaY) / 2;
        const newScale = Math.max(0.3, Math.min(3, resizeStartScale * (1 + diagonal / 300)));

        kidWrapper.dataset.scale = newScale;
        const currentRotation = parseFloat(kidWrapper.dataset.rotation) || 0;
        kidWrapper.style.transform = `rotate(${currentRotation}deg) scale(${newScale})`;

        // 드래그 중에도 wrapper 크기 업데이트 (테두리/버튼 크기 유지)
        updateEditWrapperSize(editWrapper, kidWrapper, 40);
    };

    const onResizeEnd = () => {
        isResizing = false;
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeEnd);
        document.removeEventListener('touchmove', onResizeMove);
        document.removeEventListener('touchend', onResizeEnd);
    };

    resizeBtn.addEventListener('mousedown', onResizeStart);
    resizeBtn.addEventListener('touchstart', onResizeStart, { passive: false });

    editWrapper.appendChild(resizeBtn);

    kidWrapper.appendChild(editWrapper);
}

// 돌 레이어 편집 컨트롤 (삭제, 회전/크기조절)
function createRockEditControls(rockWrapper, sectionElement) {
    // 초기 상태 저장
    rockWrapper.dataset.rotation = 0;
    rockWrapper.dataset.scale = 1;

    // 점선 테두리 래퍼
    const editWrapper = document.createElement('div');
    editWrapper.className = 'rock-edit-wrapper';

    // wrapper 크기 업데이트 함수
    const updateWrapper = () => {
        updateEditWrapperSize(editWrapper, rockWrapper, 30);
    };

    updateWrapper();
    setTimeout(updateWrapper, 100);
    setTimeout(updateWrapper, 500);

    const resizeObserver = new ResizeObserver(updateWrapper);
    resizeObserver.observe(rockWrapper);

    window.addEventListener('resize', updateWrapper);

    // 좌측 하단: 삭제 버튼
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'rock-corner-btn bottom-left';
    deleteBtn.type = 'button';
    deleteBtn.title = '돌 삭제';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/>
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    </svg>`;
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rockWrapper.remove();
        showToast('돌이 삭제되었습니다', 'success', 1500);
    });
    editWrapper.appendChild(deleteBtn);

    // 우측 하단: 크기조절 버튼 (드래그)
    const resizeBtn = document.createElement('button');
    resizeBtn.className = 'rock-corner-btn bottom-right';
    resizeBtn.type = 'button';
    resizeBtn.title = '드래그: 크기조절';
    resizeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 3h6v6"/>
        <path d="M9 21H3v-6"/>
        <path d="M21 3l-7 7"/>
        <path d="M3 21l7-7"/>
    </svg>`;

    // 크기조절 드래그 기능 (대각선 방향: 오른쪽아래로 드래그 = 크게)
    let isResizing = false;
    let resizeStartX, resizeStartY, resizeStartScale;

    const onResizeStart = (e) => {
        e.stopPropagation();
        e.preventDefault();
        isResizing = true;

        resizeStartX = e.clientX || e.touches?.[0]?.clientX;
        resizeStartY = e.clientY || e.touches?.[0]?.clientY;
        resizeStartScale = parseFloat(rockWrapper.dataset.scale || 1);

        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeEnd);
        document.addEventListener('touchmove', onResizeMove, { passive: false });
        document.addEventListener('touchend', onResizeEnd);
    };

    const onResizeMove = (e) => {
        if (!isResizing) return;
        e.preventDefault();

        const clientX = e.clientX || e.touches?.[0]?.clientX;
        const clientY = e.clientY || e.touches?.[0]?.clientY;

        // 대각선 거리 계산 (오른쪽 아래로 드래그 = 크게)
        const deltaX = clientX - resizeStartX;
        const deltaY = clientY - resizeStartY;
        const diagonal = (deltaX + deltaY) / 2;
        const newScale = Math.max(0.3, Math.min(3, resizeStartScale * (1 + diagonal / 150)));

        rockWrapper.dataset.scale = newScale;
        const currentRotation = parseFloat(rockWrapper.dataset.rotation) || 0;
        rockWrapper.style.transform = `rotate(${currentRotation}deg) scale(${newScale})`;

        // 드래그 중에도 wrapper 크기 업데이트 (테두리/버튼 크기 유지)
        updateEditWrapperSize(editWrapper, rockWrapper, 30);
    };

    const onResizeEnd = () => {
        isResizing = false;
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeEnd);
        document.removeEventListener('touchmove', onResizeMove);
        document.removeEventListener('touchend', onResizeEnd);
    };

    resizeBtn.addEventListener('mousedown', onResizeStart);
    resizeBtn.addEventListener('touchstart', onResizeStart, { passive: false });

    editWrapper.appendChild(resizeBtn);

    rockWrapper.appendChild(editWrapper);
}

/**
 * 눈 높이 기반 아이 크기 계산
 * - 좌우 눈 평균 Y가 스테이지 50% (화면 중앙)에 오도록
 * - 사진 바닥이 스테이지 92%에 오도록
 * - 두 조건에서 아이 높이가 자동 결정됨
 */
function getEyeYRatio(photoData) {
    const pose = photoData?.pose;
    if (!pose?.keypoints) return null;

    const leftEye = pose.keypoints[2];   // 왼쪽 눈
    const rightEye = pose.keypoints[5];  // 오른쪽 눈

    const validEyes = [];
    if (leftEye && leftEye.score >= 0.3) validEyes.push(leftEye);
    if (rightEye && rightEye.score >= 0.3) validEyes.push(rightEye);
    if (validEyes.length === 0) return null;

    const avgEyeY = validEyes.reduce((sum, e) => sum + e.y, 0) / validEyes.length;

    // 원본 좌표 → 처리된 이미지 좌표로 변환
    const cropInfo = photoData.cropInfo;
    const serverCropInfo = photoData.serverCropInfo;

    if (serverCropInfo && serverCropInfo.cropWidth > 0) {
        let eyeY = avgEyeY;
        let sourceHeight = photoData.originalHeight;

        if (cropInfo) {
            eyeY = eyeY - cropInfo.cropY;
            sourceHeight = cropInfo.cropH;
        }

        const uploadScaleY = serverCropInfo.originalHeight / sourceHeight;
        eyeY = eyeY * uploadScaleY;
        eyeY = eyeY - serverCropInfo.cropY;

        return eyeY / serverCropInfo.cropHeight;
    } else if (cropInfo) {
        const croppedY = avgEyeY - cropInfo.cropY;
        return croppedY / cropInfo.cropH;
    } else if (photoData.originalHeight) {
        return avgEyeY / photoData.originalHeight;
    }

    return null;
}

function calcKidHeight(stageH, photoData, processedImg) {
    const eyeYRatio = getEyeYRatio(photoData);

    if (eyeYRatio !== null && eyeYRatio > 0.05 && eyeYRatio < 0.95) {
        // 눈↔사진바닥 거리가 스테이지의 42% (92% - 50%)에 맞도록 높이 결정
        const eyeToBottomRatio = 1 - eyeYRatio;
        const kidHeight = stageH * 0.42 / eyeToBottomRatio;
        // 최소 40%, 최대 85% 제한
        return Math.max(stageH * 0.40, Math.min(stageH * 0.85, kidHeight));
    }

    // fallback: 눈 감지 실패 시 기존 로직
    const baseHeight = stageH * 0.55;
    if (!processedImg) return baseHeight;

    const aspect = processedImg.naturalWidth / processedImg.naturalHeight;
    if (aspect > 0.6) {
        const boost = Math.min(0.75, 0.55 + (aspect - 0.6) * 0.5);
        return stageH * boost;
    }
    return baseHeight;
}

/**
 * 배경 제거된 이미지의 불투명 픽셀 비율 (캐싱)
 */
function getOpaqueRatio(processedImg, photoData) {
    if (photoData._opaqueRatio !== undefined) return photoData._opaqueRatio;

    const canvas = document.createElement('canvas');
    canvas.width = processedImg.naturalWidth;
    canvas.height = processedImg.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(processedImg, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 20) count++;
    }
    photoData._opaqueRatio = count / (canvas.width * canvas.height);
    return photoData._opaqueRatio;
}

const MAX_KID_AREA_PCT = 7; // 스테이지 대비 최대 면적 (%)

/**
 * 아이 배치 레이아웃 계산 (면적 7% 제한 + 눈 50% 우선)
 * processedImg가 없으면 기존 로직 (bottom 92% 기준)
 */
function calcKidLayout(stageW, stageH, photoData, processedImg) {
    let kidHeight = calcKidHeight(stageH, photoData, processedImg);
    let scaleRatio = processedImg
        ? kidHeight / processedImg.naturalHeight
        : kidHeight / (photoData.processedImg?.naturalHeight || 1);
    const imgW = processedImg?.naturalWidth || photoData.processedImg?.naturalWidth || 1;
    const imgH = processedImg?.naturalHeight || photoData.processedImg?.naturalHeight || 1;
    let kidWidth = imgW * scaleRatio;

    // 면적 7% 제한 (배경 제거된 이미지가 있을 때만)
    let areaConstrained = false;
    if (processedImg && photoData) {
        const opaqueRatio = getOpaqueRatio(processedImg, photoData);
        const stageArea = stageW * stageH;
        const areaPct = (opaqueRatio * kidWidth * kidHeight) / stageArea * 100;

        if (areaPct > MAX_KID_AREA_PCT) {
            const targetArea = (MAX_KID_AREA_PCT / 100) * stageArea;
            const s = Math.sqrt(targetArea / (opaqueRatio * kidWidth * kidHeight));
            kidHeight *= s;
            kidWidth *= s;
            scaleRatio = kidHeight / imgH;
            areaConstrained = true;
            console.log(`📐 면적 제한 적용: ${areaPct.toFixed(1)}% → ${MAX_KID_AREA_PCT}% (scale: ${s.toFixed(2)})`);
        }
    }

    // Y 배치: 눈 50% 우선, fallback은 bottom 92%
    const eyeYRatio = getEyeYRatio(photoData);
    let kidTop;
    if (eyeYRatio !== null && eyeYRatio > 0.05 && eyeYRatio < 0.95) {
        kidTop = (stageH * 0.5) - (eyeYRatio * kidHeight);
    } else {
        kidTop = (stageH * 0.92) - kidHeight;
    }

    const kidLeft = (stageW * 0.22) - (kidWidth / 2);

    return { kidHeight, kidWidth, kidTop, kidLeft, scaleRatio };
}

// 렌더링 마무리 (조명, 버튼, 드래그, 돌 레이어)
async function finishRenderingStage(kidWrapper, stage, sectionElement, processedImg, processedUrl, photoData) {
    const stageW = stage.offsetWidth;
    const stageH = stage.offsetHeight;
    const layout = calcKidLayout(stageW, stageH, photoData, processedImg);
    const kidPixelHeight = layout.kidHeight;
    const finalScaleRatio = layout.scaleRatio;
    const kidPixelWidth = layout.kidWidth;
    const kidPixelLeft = layout.kidLeft;
    const kidPixelTop = layout.kidTop;

    // 조명 레이어 (Canvas 기반 - 아이 영역에만 적용)
    const sourceCanvas = kidWrapper.querySelector('.kid-canvas');
    const lighting = createLightingCanvas(sourceCanvas);
    kidWrapper.appendChild(lighting);

    // 편집 컨트롤 UI (점선 테두리 + 4개 코너 버튼)
    createEditControls(kidWrapper, stage, sectionElement, photoData);

    // 기존 교체 버튼 (숨김 처리됨, 호환성 유지)
    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'kid-replace-btn';
    replaceBtn.textContent = '🔄 교체';
    replaceBtn.type = 'button';
    replaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showReplaceModal(kidWrapper, stage, sectionElement);
    });
    kidWrapper.appendChild(replaceBtn);

    // 드래그 기능
    enableDrag(kidWrapper, stage, () => ({ x: 0, y: 0 }), {
        isEraserMode: () => state.isEraserMode || state.isSmartEraserMode,
        onOffsetUpdate: updateOffsetDisplay
    });

    // 포즈 키포인트 (원본 크기 전달하여 좌표 스케일링)
    if (photoData.pose) {
        drawKeypointsWithNumbers(kidWrapper, photoData.pose, processedImg, photoData.originalWidth, photoData.originalHeight, photoData.cropInfo, photoData.serverCropInfo);

        // 코 위치 기준 자동 배치
        autoPlaceByNose(kidWrapper, photoData.pose, stageW);
    }

    // 데이터 저장
    kidWrapper.dataset.processedUrl = processedUrl;
    sectionElement.dataset.originalImgUrl = photoData.originalUrl;
    kidWrapper.dataset.photoName = photoData.name;
    sectionElement.dataset.photoName = photoData.name;

    // 돌 레이어
    const rockWrapper = document.createElement('div');
    rockWrapper.className = 'rock-layer';
    rockWrapper.style.width = `${CONSTANTS.FIXED_ROCK_SCALE_PERCENT}%`;
    rockWrapper.innerHTML = `<img src="rock.png" class="rock-image">`;
    stage.appendChild(rockWrapper);

    // 돌 편집 컨트롤 추가
    createRockEditControls(rockWrapper, sectionElement);

    const rockImage = rockWrapper.querySelector('.rock-image');
    let localCentroid = { x: 0, y: 0 };
    enableDrag(rockWrapper, stage, () => localCentroid, {
        onOffsetUpdate: updateOffsetDisplay
    });

    rockImage.onload = () => {
        const centroid = analyzeAndPlaceRock(
            photoData.pose, processedImg, finalScaleRatio, kidPixelLeft, kidPixelTop,
            stageW, stageH, rockWrapper, rockImage, sectionElement,
            photoData.originalWidth, photoData.originalHeight, photoData.category,
            photoData.poseModelType, photoData.serverCropInfo
        );
        if (centroid) localCentroid = centroid;
    };

    // 초기 코 위치 + 면적 + 자세 표시 (렌더링 완료 후)
    setTimeout(() => {
        updateOffsetDisplay(kidWrapper, null, stageW, stageH);
        updateKidAreaDisplay(sectionElement);
        updatePostureDisplay(sectionElement);
    }, 100);
}

// ========== 렌더링 (순차 처리 + 빠른 애니메이션) ==========
async function renderInStageWithTransition(sectionElement, stage, originalImg, bgRemovalPromise, pose, photoData = null) {
    const stageW = stage.offsetWidth;
    const stageH = stage.offsetHeight;
    const kidPixelHeight = calcKidHeight(stageH, photoData, null);

    // 원본 이미지 기준으로 크기 계산
    const origScaleRatio = kidPixelHeight / originalImg.naturalHeight;
    const origPixelWidth = originalImg.naturalWidth * origScaleRatio;
    const kidPixelLeft = (stageW * 0.22) - (origPixelWidth / 2);
    const kidPixelTop = (stageH * 0.92) - kidPixelHeight;

    // 1단계: 원본 이미지를 먼저 그림 위에 올림
    const kidWrapper = document.createElement('div');
    kidWrapper.className = `kid-container ${(state.isEraserMode || state.isSmartEraserMode) ? 'pointer-active' : 'pointer-pass'}${state.isSmartEraserMode ? ' smart-eraser-active' : ''}`;
    kidWrapper.style.left = `${(kidPixelLeft / stageW) * 100}%`;
    kidWrapper.style.top = `${(kidPixelTop / stageH) * 100}%`;
    kidWrapper.style.width = `${(origPixelWidth / stageW) * 100}%`;
    kidWrapper.style.cursor = state.isEraserMode ? 'crosshair' : state.isSmartEraserMode ? 'pointer' : 'grab';

    // 원본 캔버스 (배경 있는 상태)
    const originalCanvas = document.createElement('canvas');
    originalCanvas.className = 'kid-canvas';
    originalCanvas.width = originalImg.naturalWidth;
    originalCanvas.height = originalImg.naturalHeight;
    originalCanvas.style.transition = 'opacity 0.2s ease-out';
    const origCtx = originalCanvas.getContext('2d');
    origCtx.drawImage(originalImg, 0, 0);
    kidWrapper.appendChild(originalCanvas);

    // 처리된 캔버스 (숨겨진 상태로 준비)
    const processedCanvas = document.createElement('canvas');
    processedCanvas.className = 'kid-canvas';
    processedCanvas.style.position = 'absolute';
    processedCanvas.style.top = '0';
    processedCanvas.style.left = '0';
    processedCanvas.style.width = '100%';
    processedCanvas.style.opacity = '0';
    processedCanvas.style.transition = 'opacity 0.2s ease-out';
    kidWrapper.appendChild(processedCanvas);

    stage.appendChild(kidWrapper);

    // 2단계: 배경 제거 완료 대기
    let processedImg, processedUrl;
    try {
        const result = await bgRemovalPromise;
        processedImg = result.processedImg;
        processedUrl = result.processedUrl;
    } catch (err) {
        console.error('배경 제거 실패:', err);
        originalCanvas.style.border = '3px solid red';
        return;
    }

    // 3단계: 배경 제거된 이미지로 0.2초 애니메이션 전환
    processedCanvas.width = processedImg.naturalWidth;
    processedCanvas.height = processedImg.naturalHeight;
    const procCtx = processedCanvas.getContext('2d');
    procCtx.drawImage(processedImg, 0, 0);
    setupEraser(processedCanvas, {
        getEraserMode: () => state.isEraserMode,
        getEraserSize: () => state.eraserSize
    });

    // 크로스페이드 애니메이션 (0.2초)
    originalCanvas.style.opacity = '0';
    processedCanvas.style.opacity = '1';

    // 애니메이션 완료 후 원본 캔버스 제거
    await new Promise(resolve => setTimeout(resolve, 200));
    originalCanvas.remove();

    // 원본 캔버스 제거 후 processedCanvas를 일반 레이아웃으로 전환
    processedCanvas.style.position = '';
    processedCanvas.style.top = '';
    processedCanvas.style.left = '';

    // 서버 크롭 정보 + 면적 제한 반영하여 크기 재계산
    const finalLayout = calcKidLayout(stageW, stageH, photoData, processedImg);
    kidWrapper.style.width = `${(finalLayout.kidWidth / stageW) * 100}%`;
    kidWrapper.style.left = `${(finalLayout.kidLeft / stageW) * 100}%`;
    kidWrapper.style.top = `${(finalLayout.kidTop / stageH) * 100}%`;

    // 스마트 지우개 오버레이 설정
    attachSmartEraser(processedCanvas, kidWrapper, photoData);

    // 조명 레이어 (Canvas 기반 - 아이 영역에만 적용)
    const lighting = createLightingCanvas(processedCanvas);
    kidWrapper.appendChild(lighting);

    // 편집 컨트롤 UI (점선 테두리 + 4개 코너 버튼)
    createEditControls(kidWrapper, stage, sectionElement, photoData);

    // 교체 버튼 (숨김 처리됨, 호환성 유지)
    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'kid-replace-btn';
    replaceBtn.textContent = '🔄 교체';
    replaceBtn.type = 'button';
    replaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showReplaceModal(kidWrapper, stage, sectionElement);
    });
    kidWrapper.appendChild(replaceBtn);

    // 드래그 기능
    enableDrag(kidWrapper, stage, () => ({ x: 0, y: 0 }), {
        isEraserMode: () => state.isEraserMode || state.isSmartEraserMode,
        onOffsetUpdate: updateOffsetDisplay
    });

    // 포즈 키포인트 (원본 크기 전달하여 좌표 스케일링)
    if (pose && photoData) {
        drawKeypointsWithNumbers(kidWrapper, pose, processedImg, photoData.originalWidth, photoData.originalHeight, photoData.cropInfo, photoData.serverCropInfo);
    } else if (pose) {
        drawKeypointsWithNumbers(kidWrapper, pose, processedImg);
    }

    // 데이터 저장
    const finalScaleRatio = kidPixelHeight / processedImg.naturalHeight;
    kidWrapper.dataset.processedUrl = processedUrl;
    sectionElement.dataset.originalImgUrl = originalImg.src;
    if (photoData) {
        kidWrapper.dataset.photoName = photoData.name;
        sectionElement.dataset.photoName = photoData.name;
    }

    // 돌 레이어
    const rockWrapper = document.createElement('div');
    rockWrapper.className = 'rock-layer';
    rockWrapper.style.width = `${CONSTANTS.FIXED_ROCK_SCALE_PERCENT}%`;
    rockWrapper.innerHTML = `<img src="rock.png" class="rock-image">`;
    stage.appendChild(rockWrapper);

    // 돌 편집 컨트롤 추가
    createRockEditControls(rockWrapper, sectionElement);

    const rockImage = rockWrapper.querySelector('.rock-image');
    let localCentroid = { x: 0, y: 0 };
    enableDrag(rockWrapper, stage, () => localCentroid, {
        onOffsetUpdate: updateOffsetDisplay
    });

    rockImage.onload = () => {
        const centroid = analyzeAndPlaceRock(
            pose, processedImg, finalScaleRatio, kidPixelLeft, kidPixelTop,
            stageW, stageH, rockWrapper, rockImage, sectionElement,
            photoData?.originalWidth, photoData?.originalHeight, photoData?.category,
            photoData?.poseModelType, photoData?.serverCropInfo
        );
        if (centroid) localCentroid = centroid;
    };
}

// ========== 렌더링 (기존 함수 - 교체 시 사용) ==========
function renderInStage(sectionElement, stage, originalImg, processedImg, processedUrl, pose, photoData = null) {
    const stageW = stage.offsetWidth;
    const stageH = stage.offsetHeight;
    const layout = calcKidLayout(stageW, stageH, photoData, processedImg);
    const kidPixelHeight = layout.kidHeight;
    const kidScaleRatio = layout.scaleRatio;
    const kidPixelWidth = layout.kidWidth;
    const kidPixelLeft = layout.kidLeft;
    const kidPixelTop = layout.kidTop;

    // 아이 컨테이너 생성
    const kidWrapper = document.createElement('div');
    kidWrapper.className = `kid-container ${(state.isEraserMode || state.isSmartEraserMode) ? 'pointer-active' : 'pointer-pass'}${state.isSmartEraserMode ? ' smart-eraser-active' : ''}`;
    kidWrapper.style.left = `${(kidPixelLeft / stageW) * 100}%`;
    kidWrapper.style.top = `${(kidPixelTop / stageH) * 100}%`;
    kidWrapper.style.width = `${(kidPixelWidth / stageW) * 100}%`;
    kidWrapper.style.cursor = state.isEraserMode ? 'crosshair' : state.isSmartEraserMode ? 'pointer' : 'grab';

    // 캔버스 생성
    const canvas = document.createElement('canvas');
    canvas.className = 'kid-canvas';
    canvas.width = processedImg.naturalWidth;
    canvas.height = processedImg.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(processedImg, 0, 0);
    setupEraser(canvas, {
        getEraserMode: () => state.isEraserMode,
        getEraserSize: () => state.eraserSize
    });
    kidWrapper.appendChild(canvas);

    // 스마트 지우개 오버레이 설정
    attachSmartEraser(canvas, kidWrapper, photoData);

    // 조명 레이어 (Canvas 기반 - 아이 영역에만 적용)
    const lighting = createLightingCanvas(canvas);
    kidWrapper.appendChild(lighting);

    // 편집 컨트롤 UI (점선 테두리 + 4개 코너 버튼)
    createEditControls(kidWrapper, stage, sectionElement, photoData);

    // 교체 버튼 (숨김 처리됨, 호환성 유지)
    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'kid-replace-btn';
    replaceBtn.textContent = '🔄 교체';
    replaceBtn.type = 'button';
    replaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showReplaceModal(kidWrapper, stage, sectionElement);
    });
    kidWrapper.appendChild(replaceBtn);

    stage.appendChild(kidWrapper);

    // 드래그 기능
    enableDrag(kidWrapper, stage, () => ({ x: 0, y: 0 }), {
        isEraserMode: () => state.isEraserMode || state.isSmartEraserMode,
        onOffsetUpdate: updateOffsetDisplay
    });

    // 포즈 키포인트 (원본 크기 전달하여 좌표 스케일링)
    if (pose && photoData) {
        drawKeypointsWithNumbers(kidWrapper, pose, processedImg, photoData.originalWidth, photoData.originalHeight, photoData.cropInfo, photoData.serverCropInfo);
    } else if (pose) {
        drawKeypointsWithNumbers(kidWrapper, pose, processedImg);
    }

    // 데이터 저장
    kidWrapper.dataset.processedUrl = processedUrl;
    sectionElement.dataset.originalImgUrl = originalImg.src;
    if (photoData) {
        kidWrapper.dataset.photoName = photoData.name;
        sectionElement.dataset.photoName = photoData.name;
    }

    // 돌 레이어
    const rockWrapper = document.createElement('div');
    rockWrapper.className = 'rock-layer';
    rockWrapper.style.width = `${CONSTANTS.FIXED_ROCK_SCALE_PERCENT}%`;
    rockWrapper.innerHTML = `<img src="rock.png" class="rock-image">`;
    stage.appendChild(rockWrapper);

    // 돌 편집 컨트롤 추가
    createRockEditControls(rockWrapper, sectionElement);

    const rockImage = rockWrapper.querySelector('.rock-image');
    let localCentroid = { x: 0, y: 0 };
    enableDrag(rockWrapper, stage, () => localCentroid, {
        onOffsetUpdate: updateOffsetDisplay
    });

    rockImage.onload = () => {
        const centroid = analyzeAndPlaceRock(
            pose, processedImg, kidScaleRatio, kidPixelLeft, kidPixelTop,
            stageW, stageH, rockWrapper, rockImage, sectionElement,
            photoData?.originalWidth, photoData?.originalHeight, photoData?.category,
            photoData?.poseModelType, photoData?.serverCropInfo
        );
        if (centroid) localCentroid = centroid;
    };
}

// ========== 이벤트 리스너 ==========
function setupEventListeners() {
    // 포즈 모델 변경 시 범례 업데이트 + 설정 저장
    document.querySelectorAll('input[name="pose-model"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateLegendForModel();
            saveSettings();
        });
    });

    // 배경 제거 서버 변경 시 설정 저장
    document.querySelectorAll('input[name="bg-server"]').forEach(radio => {
        radio.addEventListener('change', saveSettings);
    });

    // 배경 제거 모델 변경 시 설정 저장
    document.querySelectorAll('input[name="bg-model"]').forEach(radio => {
        radio.addEventListener('change', saveSettings);
    });

    // 배경 제거 품질 변경 시 설정 저장
    document.querySelectorAll('input[name="bg-quality"]').forEach(radio => {
        radio.addEventListener('change', saveSettings);
    });

    // 지우개 크기
    elements.eraserSizeSlider.addEventListener('input', (e) => {
        state.eraserSize = parseInt(e.target.value);
        elements.eraserSizeVal.innerText = state.eraserSize;
        saveSettings();
    });

    // 조명 강도 슬라이더
    elements.lightingIntensitySlider.addEventListener('input', (e) => {
        state.lightingSettings.intensity = parseInt(e.target.value);
        elements.lightingIntensityVal.textContent = state.lightingSettings.intensity;
        restoreLightingLayers();
        saveSettings();
    });

    // Intersection Observer
    const observerOptions = { root: null, rootMargin: '0px', threshold: 0.6 };
    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const l = parseFloat(entry.target.dataset.lScore) || 0;
                const r = parseFloat(entry.target.dataset.rScore) || 0;
                updateConfidenceDisplay(l, r);

                // 스크롤 시 해당 섹션의 코 위치 + 면적 표시
                const stage = entry.target.querySelector('.scene-stage');
                const kidWrapper = stage?.querySelector('.kid-container');
                if (kidWrapper && stage) {
                    updateOffsetDisplay(kidWrapper, null, stage.offsetWidth, stage.offsetHeight);
                }
                updateKidAreaDisplay(entry.target);
                updatePostureDisplay(entry.target);
            }
        });
    }, observerOptions);

    // 드래그 앤 드롭 (브라우저 기본 동작 완전 차단)
    const preventDefaults = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
        document.addEventListener(eventName, preventDefaults, false);
    });

    // 드래그 시각적 피드백
    ['dragenter', 'dragover'].forEach(eventName => {
        document.body.addEventListener(eventName, () => {
            document.body.classList.add('drag-active');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, () => {
            document.body.classList.remove('drag-active');
        }, false);
    });

    // 파일 드롭 처리
    document.body.addEventListener('drop', (e) => {
        console.log('📁 파일 드롭 감지:', e.dataTransfer.files);
        const files = Array.from(e.dataTransfer.files).filter(f =>
            f.type.startsWith('image/') || /\.heic$/i.test(f.name)
        );
        if (files.length === 0) {
            console.log('⚠️ 이미지 파일이 없습니다');
            return;
        }
        console.log('✅ 이미지 파일:', files.map(f => f.name));
        handleBatchUpload(files);
    }, false);

    // 생성하기 버튼
    elements.generateBtn.addEventListener('click', async () => {
        const selectedPhotos = [];

        document.querySelectorAll('.thumbnail-item.selected').forEach(item => {
            const category = item.dataset.category;
            const index = parseInt(item.dataset.index);
            selectedPhotos.push(state.analyzedPhotos[category][index]);
        });

        // multi 카테고리(0명 또는 2명 이상 감지) 사진은 생성에서 제외
        const filteredSelected = selectedPhotos.filter(p => p.category !== 'multi');
        const photosToGenerate = filteredSelected.length > 0
            ? filteredSelected
            : getAllPhotos();

        if (photosToGenerate.length === 0) {
            alert("생성할 사진이 없습니다.");
            return;
        }

        elements.loadingIndicator.style.display = 'block';

        // 파이프라인 처리: 1번 완료 → 2번 요청 시작 + 1번 애니메이션 동시 진행
        let nextBgPromise = null;

        for (let i = 0; i < photosToGenerate.length; i++) {
            const photoData = photosToGenerate[i];
            elements.loadingIndicator.textContent = `${i + 1}/${photosToGenerate.length} 처리 중...`;

            // 1. 섹션 생성 + 스크롤
            const { section, stage } = createNewSection(i, photoData);
            elements.mainWrapper.appendChild(section);
            sectionObserver.observe(section);
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // 2. 현재 사진의 배경 제거 (첫 번째는 새로 요청, 이후는 미리 요청해둔 것 사용)
            const bgRemovalPromise = nextBgPromise || startBackgroundRemoval(photoData);
            if (i === 0) console.log(`📤 ${i + 1}번 배경 제거 요청: ${photoData.name}`);

            // 3. 원본 표시 + 배경 제거 완료 대기
            const originalImg = photoData.processedImg;
            const stageW = stage.offsetWidth;
            const stageH = stage.offsetHeight;
            const kidPixelHeight = calcKidHeight(stageH, photoData, null);
            const origScaleRatio = kidPixelHeight / originalImg.naturalHeight;
            const origPixelWidth = originalImg.naturalWidth * origScaleRatio;
            const kidPixelLeft = (stageW * 0.22) - (origPixelWidth / 2);
            const kidPixelTop = (stageH * 0.92) - kidPixelHeight;

            // 원본 이미지 먼저 표시
            const kidWrapper = document.createElement('div');
            kidWrapper.className = `kid-container ${(state.isEraserMode || state.isSmartEraserMode) ? 'pointer-active' : 'pointer-pass'}${state.isSmartEraserMode ? ' smart-eraser-active' : ''}`;
            kidWrapper.style.left = `${(kidPixelLeft / stageW) * 100}%`;
            kidWrapper.style.top = `${(kidPixelTop / stageH) * 100}%`;
            kidWrapper.style.width = `${(origPixelWidth / stageW) * 100}%`;
            kidWrapper.style.cursor = state.isEraserMode ? 'crosshair' : state.isSmartEraserMode ? 'pointer' : 'grab';

            const originalCanvas = document.createElement('canvas');
            originalCanvas.className = 'kid-canvas';
            originalCanvas.width = originalImg.naturalWidth;
            originalCanvas.height = originalImg.naturalHeight;
            originalCanvas.style.transition = 'opacity 0.5s ease-out';
            originalCanvas.getContext('2d').drawImage(originalImg, 0, 0);
            kidWrapper.appendChild(originalCanvas);

            const processedCanvas = document.createElement('canvas');
            processedCanvas.className = 'kid-canvas';
            processedCanvas.style.position = 'absolute';
            processedCanvas.style.top = '0';
            processedCanvas.style.left = '0';
            processedCanvas.style.width = '100%';
            processedCanvas.style.opacity = '0';
            processedCanvas.style.transition = 'opacity 0.5s ease-out';
            kidWrapper.appendChild(processedCanvas);

            stage.appendChild(kidWrapper);

            // 4. 원본 사진 최소 0.5초 표시 + 배경 제거 완료 대기 (동시 진행)
            const showOriginalPromise = new Promise(resolve => setTimeout(resolve, 500));

            let processedImg, processedUrl;
            try {
                const [result] = await Promise.all([bgRemovalPromise, showOriginalPromise]);
                processedImg = result.processedImg;
                processedUrl = result.processedUrl;

                // 대시보드 업데이트 (BGQA 점수 표시)
                updateDashboard();
            } catch (err) {
                console.error(`사진 ${i + 1} 처리 중 오류:`, err);
                originalCanvas.style.border = '3px solid red';
                nextBgPromise = null;
                continue;
            }

            // 5. 배경 제거 완료! → 다음 사진 요청 즉시 시작 (애니메이션과 동시)
            if (i + 1 < photosToGenerate.length) {
                console.log(`📤 ${i + 2}번 배경 제거 요청: ${photosToGenerate[i + 1].name}`);
                nextBgPromise = startBackgroundRemoval(photosToGenerate[i + 1]);
            }

            // 6. 0.5초 애니메이션으로 배경 사라지는 효과
            processedCanvas.width = processedImg.naturalWidth;
            processedCanvas.height = processedImg.naturalHeight;
            processedCanvas.getContext('2d').drawImage(processedImg, 0, 0);
            setupEraser(processedCanvas, {
                getEraserMode: () => state.isEraserMode,
                getEraserSize: () => state.eraserSize
            });

            originalCanvas.style.opacity = '0';
            processedCanvas.style.opacity = '1';
            await new Promise(resolve => setTimeout(resolve, 500));
            originalCanvas.remove();

            // 원본 캔버스 제거 후 processedCanvas를 일반 레이아웃으로 전환
            // (position: absolute → static으로 변경해야 kidWrapper의 height가 결정됨)
            processedCanvas.style.position = '';
            processedCanvas.style.top = '';
            processedCanvas.style.left = '';

            // 처리된 이미지 크기 + 면적 제한 반영하여 재계산
            const genLayout = calcKidLayout(stageW, stageH, photoData, processedImg);
            kidWrapper.style.width = `${(genLayout.kidWidth / stageW) * 100}%`;
            kidWrapper.style.left = `${(genLayout.kidLeft / stageW) * 100}%`;
            kidWrapper.style.top = `${(genLayout.kidTop / stageH) * 100}%`;

            // 스마트 지우개 오버레이 설정
            attachSmartEraser(processedCanvas, kidWrapper, photoData);

            // 7. 나머지 요소 추가 (조명, 버튼, 드래그 등)
            await finishRenderingStage(kidWrapper, stage, section, processedImg, processedUrl, photoData);
            console.log(`✅ ${i + 1}/${photosToGenerate.length} 완료`);
        }

        elements.loadingIndicator.style.display = 'none';
        console.log(`🎉 전체 ${photosToGenerate.length}개 사진 처리 완료!`);
    });

    // 모달 닫기
    elements.photoReplaceModal.addEventListener('click', (e) => {
        if (e.target.id === 'photo-replace-modal') {
            e.target.classList.remove('show');
        }
    });

    // 주기적 조명 레이어 복구
    setInterval(restoreLightingLayers, 2000);

    // ========== 서버 설정 UI 이벤트 리스너 ==========
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const mainServerInput = document.getElementById('main-server-input');
    const backupServerInput = document.getElementById('backup-server-input');
    const settingsSaveBtn = document.getElementById('settings-save-btn');
    const settingsResetBtn = document.getElementById('settings-reset-btn');
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    const currentMainServer = document.getElementById('current-main-server');
    const currentBackupServer = document.getElementById('current-backup-server');

    // 현재 설정 표시 함수
    function updateCurrentSettingsDisplay() {
        const settings = getServerSettings();
        currentMainServer.textContent = `메인: ${settings.mainServerUrl}`;
        currentBackupServer.textContent = `백업: ${settings.backupServerUrl}`;
        mainServerInput.value = settings.mainServerUrl;
        backupServerInput.value = settings.backupServerUrl;
    }

    // 설정 버튼 클릭 - 모달 열기
    settingsBtn.addEventListener('click', () => {
        updateCurrentSettingsDisplay();
        settingsModal.classList.add('show');
    });

    // 저장 버튼
    settingsSaveBtn.addEventListener('click', () => {
        const mainUrl = mainServerInput.value.trim();
        const backupUrl = backupServerInput.value.trim();

        if (!mainUrl || !backupUrl) {
            alert('서버 URL을 모두 입력해주세요.');
            return;
        }

        saveServerSettings(mainUrl, backupUrl);
        updateCurrentSettingsDisplay();
        settingsModal.classList.remove('show');
    });

    // 초기화 버튼
    settingsResetBtn.addEventListener('click', () => {
        resetServerSettings();
        updateCurrentSettingsDisplay();
    });

    // 닫기 버튼
    settingsCloseBtn.addEventListener('click', () => {
        settingsModal.classList.remove('show');
    });

    // 모달 바깥 클릭 시 닫기
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('show');
        }
    });
}

// ========== 전역 함수 노출 ==========
window.toggleMarkers = toggleMarkers;
window.toggleEraserMode = toggleEraserMode;
window.toggleSmartEraserMode = toggleSmartEraserMode;
window.toggleControlsBorder = toggleControlsBorder;
window.toggleSmartCrop = toggleSmartCrop;
window.toggleGrid = toggleGrid;

// ========== 초기화 실행 ==========
createLegend(elements.legendList);
elements.generateBtn.disabled = true;
loadSettings();  // 설정 복원을 가장 먼저 실행
setupEventListeners();
initSystem();
