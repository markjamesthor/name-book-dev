/**
 * 몽비 테스트 - 유틸리티 모듈
 * URL 추적, 드래그 기능, 공통 유틸리티
 */

// ========== 상수 (localStorage 우선 사용) ==========
const DEFAULT_MAIN_SERVER = 'http://172.30.1.51:5000';
const DEFAULT_BACKUP_SERVER = 'http://localhost:5001';

export const CONSTANTS = {
    FIXED_ROCK_SCALE_PERCENT: 15,
    FIXED_Y_OFFSET: -70,
    MIN_CONFIDENCE: 0.8,
    // 서버 설정 - localStorage 값 우선 사용
    get MAIN_SERVER_URL() {
        return localStorage.getItem('mainServerUrl') || DEFAULT_MAIN_SERVER;
    },
    get BACKUP_SERVER_URL() {
        return localStorage.getItem('backupServerUrl') || DEFAULT_BACKUP_SERVER;
    },
    CONNECT_TIMEOUT: 500,   // 접속 타임아웃: 0.5초
    READ_TIMEOUT: 30000     // 작업 타임아웃: 30초
};

// ========== 토스트 메시지 시스템 ==========
export function showToast(message, type = 'info', duration = 4000) {
    // 토스트 컨테이너가 없으면 생성
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'warning' ? '⚡' : type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    // 애니메이션 시작
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // 일정 시간 후 제거
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ========== 서버 설정 관리 ==========
export function getServerSettings() {
    return {
        mainServerUrl: CONSTANTS.MAIN_SERVER_URL,
        backupServerUrl: CONSTANTS.BACKUP_SERVER_URL
    };
}

export function saveServerSettings(mainUrl, backupUrl) {
    localStorage.setItem('mainServerUrl', mainUrl);
    localStorage.setItem('backupServerUrl', backupUrl);
    showToast('서버 설정이 저장되었습니다.', 'success', 2000);
    console.log('💾 서버 설정 저장됨:', { mainUrl, backupUrl });
}

export function resetServerSettings() {
    localStorage.removeItem('mainServerUrl');
    localStorage.removeItem('backupServerUrl');
    showToast('서버 설정이 기본값으로 초기화되었습니다.', 'info', 2000);
    console.log('🔄 서버 설정 초기화됨');
}

// BlazePose 33개 키포인트 (브라우저 기반)
export const BODY_PARTS = {
    0: "코", 1: "왼쪽 눈(안)", 2: "왼쪽 눈", 3: "왼쪽 눈(밖)", 4: "오른쪽 눈(안)",
    5: "오른쪽 눈", 6: "오른쪽 눈(밖)", 7: "왼쪽 귀", 8: "오른쪽 귀", 9: "입(왼)", 10: "입(오)",
    11: "왼쪽 어깨", 12: "오른쪽 어깨", 13: "왼쪽 팔꿈치", 14: "오른쪽 팔꿈치",
    15: "왼쪽 손목", 16: "오른쪽 손목", 17: "왼쪽 새끼", 18: "오른쪽 새끼",
    19: "왼쪽 검지", 20: "오른쪽 검지", 21: "왼쪽 엄지", 22: "오른쪽 엄지",
    23: "왼쪽 엉덩이", 24: "오른쪽 엉덩이", 25: "왼쪽 무릎", 26: "오른쪽 무릎",
    27: "왼쪽 발목", 28: "오른쪽 발목", 29: "왼쪽 뒤꿈치", 30: "오른쪽 뒤꿈치",
    31: "왼쪽 발끝", 32: "오른쪽 발끝"
};

// COCO 17개 키포인트 → BlazePose 인덱스 매핑 (ViTPose용)
// 서버에서 COCO를 BlazePose로 변환하므로, 실제 마커는 BlazePose 인덱스로 표시됨
export const COCO_TO_BLAZEPOSE_MAP = {
    0: 0,    // nose → nose
    1: 2,    // left_eye → left_eye
    2: 5,    // right_eye → right_eye
    3: 7,    // left_ear → left_ear
    4: 8,    // right_ear → right_ear
    5: 11,   // left_shoulder → left_shoulder
    6: 12,   // right_shoulder → right_shoulder
    7: 13,   // left_elbow → left_elbow
    8: 14,   // right_elbow → right_elbow
    9: 15,   // left_wrist → left_wrist
    10: 16,  // right_wrist → right_wrist
    11: 23,  // left_hip → left_hip
    12: 24,  // right_hip → right_hip
    13: 25,  // left_knee → left_knee
    14: 26,  // right_knee → right_knee
    15: 27,  // left_ankle → left_ankle
    16: 28,  // right_ankle → right_ankle
};

// COCO 키포인트 이름 (BlazePose 인덱스로 매핑된 상태)
export const COCO_BODY_PARTS = {
    0: "코",
    2: "왼쪽 눈",
    5: "오른쪽 눈",
    7: "왼쪽 귀",
    8: "오른쪽 귀",
    11: "왼쪽 어깨",
    12: "오른쪽 어깨",
    13: "왼쪽 팔꿈치",
    14: "오른쪽 팔꿈치",
    15: "왼쪽 손목",
    16: "오른쪽 손목",
    23: "왼쪽 엉덩이",
    24: "오른쪽 엉덩이",
    25: "왼쪽 무릎",
    26: "오른쪽 무릎",
    27: "왼쪽 발목 ⭐",  // ViTPose에서 발 판단 기준
    28: "오른쪽 발목 ⭐", // ViTPose에서 발 판단 기준
};

// ViTPose에서 유효한 BlazePose 인덱스 목록
export const VITPOSE_VALID_INDICES = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// ========== 메모리 관리: URL 추적 ==========
export const urlTracker = {
    activeUrls: new Set(),

    create(blob) {
        const url = URL.createObjectURL(blob);
        this.activeUrls.add(url);
        return url;
    },

    revoke(url) {
        if (url && this.activeUrls.has(url)) {
            URL.revokeObjectURL(url);
            this.activeUrls.delete(url);
        }
    },

    revokeAll() {
        this.activeUrls.forEach(url => {
            URL.revokeObjectURL(url);
        });
        this.activeUrls.clear();
        console.log('🧹 모든 Object URL이 정리되었습니다.');
    },

    get count() {
        return this.activeUrls.size;
    }
};

// 페이지 종료 시 모든 URL 정리
window.addEventListener('beforeunload', () => {
    urlTracker.revokeAll();
});

// ========== 드래그 기능 ==========
export function enableDrag(element, parentStage, getCentroidFn, options = {}) {
    const { skipOffsetDisplay = false, isEraserMode = () => false, onOffsetUpdate = null } = options;

    let isDragging = false;
    let startX, startY, startLeftPct, startTopPct;

    const start = (e) => {
        if (e.button === 2) return;
        if (e.target.classList.contains('kid-replace-btn')) return;
        if (isEraserMode() && element.classList.contains('kid-container')) return;

        e.stopPropagation();
        isDragging = true;
        startX = e.clientX || e.touches[0].clientX;
        startY = e.clientY || e.touches[0].clientY;
        startLeftPct = parseFloat(element.style.left) || 0;
        startTopPct = parseFloat(element.style.top) || 0;
        element.style.cursor = 'grabbing';

        if (!skipOffsetDisplay && getCentroidFn && onOffsetUpdate) {
            onOffsetUpdate(element, getCentroidFn(), parentStage.offsetWidth, parentStage.offsetHeight);
        }
    };

    const move = (e) => {
        if (!isDragging) return;
        if (isEraserMode() && element.classList.contains('kid-container')) {
            isDragging = false;
            element.style.cursor = 'crosshair';
            return;
        }

        e.preventDefault();
        const cx = e.clientX || e.touches[0].clientX;
        const cy = e.clientY || e.touches[0].clientY;
        const dxPx = cx - startX;
        const dyPx = cy - startY;
        const dxPct = (dxPx / parentStage.offsetWidth) * 100;
        const dyPct = (dyPx / parentStage.offsetHeight) * 100;
        element.style.left = `${startLeftPct + dxPct}%`;
        element.style.top = `${startTopPct + dyPct}%`;

        if (!skipOffsetDisplay && getCentroidFn && onOffsetUpdate) {
            onOffsetUpdate(element, getCentroidFn(), parentStage.offsetWidth, parentStage.offsetHeight);
        }
    };

    const end = () => {
        isDragging = false;
        if (element.classList.contains('kid-container')) {
            element.style.cursor = isEraserMode() ? 'crosshair' : 'grab';
        } else {
            element.style.cursor = 'grab';
        }
    };

    element.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    element.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);

    // 이벤트 리스너 제거를 위한 cleanup 함수 반환
    return () => {
        element.removeEventListener('mousedown', start);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', end);
        element.removeEventListener('touchstart', start);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend', end);
    };
}

// ========== 지우개 기능 ==========
export function setupEraser(canvas, options = {}) {
    const { getEraserMode = () => false, getEraserSize = () => 20 } = options;

    let isDrawing = false;
    const ctx = canvas.getContext('2d');

    // 지우개 커서 원 생성
    const cursor = document.createElement('div');
    cursor.style.cssText = 'position:fixed;pointer-events:none;border:2px solid rgba(255,255,255,0.8);border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,0.3);display:none;z-index:9999;box-sizing:border-box;';
    document.body.appendChild(cursor);

    function updateCursor(e) {
        if (!getEraserMode()) {
            cursor.style.display = 'none';
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const displayDiameter = (getEraserSize() * 2) / scaleX;
        cursor.style.width = `${displayDiameter}px`;
        cursor.style.height = `${displayDiameter}px`;
        cursor.style.left = `${e.clientX - displayDiameter / 2}px`;
        cursor.style.top = `${e.clientY - displayDiameter / 2}px`;
        cursor.style.display = 'block';
    }

    function erase(e) {
        if (!getEraserMode() || !isDrawing) return;
        e.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, getEraserSize(), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }

    canvas.addEventListener('mousedown', (e) => {
        if (getEraserMode()) {
            e.stopPropagation();
            isDrawing = true;
            erase(e);
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        updateCursor(e);
        if (getEraserMode() && isDrawing) {
            e.stopPropagation();
            erase(e);
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (getEraserMode()) {
            e.stopPropagation();
        }
        isDrawing = false;
    });

    canvas.addEventListener('mouseleave', () => {
        isDrawing = false;
        cursor.style.display = 'none';
    });
}

// ========== 유틸리티 함수 ==========
export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// 이미지 리사이즈 (업로드 전 최적화)
export async function resizeImageForUpload(file, maxSize = 1440) {
    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const { width, height } = img;

            // 이미 작으면 원본 반환
            if (width <= maxSize && height <= maxSize) {
                resolve(file);
                return;
            }

            // 비율 유지하며 리사이즈
            const scale = Math.min(maxSize / width, maxSize / height);
            const newWidth = Math.round(width * scale);
            const newHeight = Math.round(height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = newWidth;
            canvas.height = newHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, newWidth, newHeight);

            // JPEG로 변환 (PNG보다 훨씬 작음, 품질 100%)
            canvas.toBlob((blob) => {
                const resizedFile = new File([blob], file.name, { type: 'image/jpeg' });
                console.log(`📐 리사이즈: ${width}x${height} → ${newWidth}x${newHeight} (${(file.size/1024).toFixed(0)}KB → ${(blob.size/1024).toFixed(0)}KB)`);
                resolve(resizedFile);
            }, 'image/jpeg', 1.0);
        };
        img.src = objectUrl;
    });
}

export async function checkServerConnection() {
    // 메인 서버 연결 확인 (0.5초 타임아웃)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.CONNECT_TIMEOUT);
        await fetch(`${CONSTANTS.MAIN_SERVER_URL}/docs`, {
            method: 'HEAD',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        console.log("✅ 메인 서버(Windows/RTX) 연결됨");
        return { connected: true, server: 'main' };
    } catch (e) {
        console.warn("메인 서버 응답 없음(0.5초 초과/꺼짐). 백업 서버 확인 중...");
    }

    // 백업 서버 연결 확인
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.CONNECT_TIMEOUT);
        await fetch(`${CONSTANTS.BACKUP_SERVER_URL}/docs`, {
            method: 'HEAD',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        console.log("✅ 백업 서버(Mac/Local) 연결됨");
        return { connected: true, server: 'backup' };
    } catch (e) {
        console.warn("❌ 모든 서버가 꺼져 있습니다.");
        return { connected: false, server: null };
    }
}

// 타임아웃이 있는 fetch 함수
function fetchWithTimeout(url, options, timeout) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error('Timeout'));
        }, timeout);

        fetch(url, { ...options, signal: controller.signal })
            .then(response => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch(err => {
                clearTimeout(timeoutId);
                reject(err);
            });
    });
}

// 서버 접속 확인 (Connect 타임아웃만 적용)
async function checkServerAvailable(serverUrl) {
    try {
        await fetchWithTimeout(`${serverUrl}/docs`, { method: 'HEAD' }, CONSTANTS.CONNECT_TIMEOUT);
        return true;
    } catch (e) {
        return false;
    }
}

// 현재 활성 서버 캐시 (pre-check 없이 바로 요청)
let activeServer = 'main';

// Failover 로직이 적용된 배경 제거 요청 함수 (속도 최적화)
// pre-check 제거: 바로 요청하고 실패하면 전환
// preferredServer: 'windows' | 'mac' | null (null이면 자동 선택)
export async function fetchWithFailover(endpoint, options, preferredServer = null) {
    const mainUrl = `${CONSTANTS.MAIN_SERVER_URL}${endpoint}`;
    const backupUrl = `${CONSTANTS.BACKUP_SERVER_URL}${endpoint}`;

    // 사용자가 서버를 지정한 경우 해당 서버를 우선 사용
    let useMain;
    if (preferredServer === 'windows') {
        useMain = true;
    } else if (preferredServer === 'mac') {
        useMain = false;
    } else {
        useMain = activeServer === 'main';
    }

    // 1. 선택된 서버로 바로 요청 (pre-check 없음)
    const primaryUrl = useMain ? mainUrl : backupUrl;
    const fallbackUrl = useMain ? backupUrl : mainUrl;
    const primaryName = useMain ? 'Windows/RTX' : 'Mac/Local';
    const fallbackName = useMain ? 'Mac/Local' : 'Windows/RTX';

    try {
        const response = await fetchWithTimeout(primaryUrl, options, CONSTANTS.READ_TIMEOUT);
        if (!response.ok) {
            throw new Error(`서버 응답 오류: ${response.status}`);
        }
        return { response, server: activeServer };
    } catch (err) {
        console.warn(`${primaryName} 서버 실패: ${err.message}`);
    }

    // 2. Fallback 서버로 전환
    showToast(`⚡ ${primaryName} 실패 → ${fallbackName}으로 전환`, 'warning', 3000);

    try {
        const response = await fetchWithTimeout(fallbackUrl, options, CONSTANTS.READ_TIMEOUT);
        if (!response.ok) {
            throw new Error(`서버 응답 오류: ${response.status}`);
        }
        // 성공한 서버를 기본으로 설정
        activeServer = activeServer === 'main' ? 'backup' : 'main';
        console.log(`✅ 활성 서버 변경: ${fallbackName}`);
        return { response, server: activeServer };
    } catch (err) {
        console.error(`❌ 모든 서버 실패`);
        showToast('❌ 모든 서버가 응답하지 않습니다!', 'error', 5000);
        throw new Error('모든 서버가 응답하지 않습니다.');
    }
}
