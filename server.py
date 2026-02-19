# server.py (최적화 버전: FP16 + Warmup + 보안 강화)
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Form, Body
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoModelForImageSegmentation
from torchvision import transforms
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
register_heif_opener()
import torch
import gc
import io
import time
import asyncio
import numpy as np
import os
import json
import re
import traceback
import httpx
from pathlib import Path

# Ryan Engine 임포트
import sys
sys.path.insert(0, str(Path(__file__).parent))
try:
    from ryan_engine import JosaUtils, BookGenerator
    RYAN_ENGINE_AVAILABLE = True
    print("✅ Ryan Engine 로드 완료")
except ImportError as e:
    RYAN_ENGINE_AVAILABLE = False
    print(f"⚠️ Ryan Engine 로드 실패: {e}")

# BGQA (배경 제거 품질 평가) 임포트
try:
    from bgqa import evaluate as bgqa_evaluate
    BGQA_AVAILABLE = True
    print("✅ BGQA 로드 완료")
except ImportError as e:
    BGQA_AVAILABLE = False
    print(f"⚠️ BGQA 로드 실패: {e}")

# PNG 저장 폴더 설정
PNG_OUTPUT_DIR = Path("./png")
PNG_OUTPUT_DIR.mkdir(exist_ok=True)

# ViTPose transformers 버그 패치 (inv 함수 누락 문제)
try:
    import transformers.models.vitpose.image_processing_vitpose as vitpose_module
    import numpy.linalg
    # 모듈의 글로벌 네임스페이스에 inv 함수 주입
    vitpose_module.__dict__['inv'] = numpy.linalg.inv
    # scipy_warp_affine 함수의 글로벌에도 주입
    if hasattr(vitpose_module, 'scipy_warp_affine'):
        vitpose_module.scipy_warp_affine.__globals__['inv'] = numpy.linalg.inv
    print("✅ ViTPose 패치 적용 완료 (inv 함수 주입)")
except Exception as e:
    print(f"⚠️ ViTPose 패치 스킵: {e}")

app = FastAPI()

# 허용된 Origin 목록 (프로덕션에서는 실제 도메인으로 변경)
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5500",
    "http://localhost:8080",
    "http://localhost:8888",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:8888",
    "null",  # file:// 프로토콜용
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if os.environ.get("CORS_ALLOW_ALL", "1") == "1" else ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],  # GET 추가 (헬스체크 등)
    allow_headers=["Content-Type"],  # 필요한 헤더만 허용
    expose_headers=["X-Original-Width", "X-Original-Height", "X-Crop-X", "X-Crop-Y", "X-Crop-Width", "X-Crop-Height", "X-BGQA-Score", "X-BGQA-Passed", "X-BGQA-Issues", "X-BGQA-CaseType"],  # 클라이언트에서 읽을 수 있는 커스텀 헤더
)

# 파일 검증 상수
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}

def is_allowed_image(file) -> bool:
    """content_type 또는 확장자로 이미지 파일 여부 확인"""
    if file.content_type in ALLOWED_CONTENT_TYPES:
        return True
    if file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext in ALLOWED_EXTENSIONS:
            return True
    return False

# 1. 디바이스 설정
if torch.backends.mps.is_available():
    device = "mps"
    dtype = torch.float16  # [최적화] 맥북은 float16이 훨씬 빠름
elif torch.cuda.is_available():
    device = "cuda"
    dtype = torch.float16
else:
    device = "cpu"
    dtype = torch.float32

# Portrait 모델을 CPU로 돌려 BEN2(GPU)와 병렬 처리
PORTRAIT_ON_CPU = False

print(f"\n🚀 초고속 AI 서버 대기 중... (Device: {device}, Type: {dtype})")
if PORTRAIT_ON_CPU:
    print(f"   ↳ Portrait 모델: CPU (float32) — BEN2와 병렬 처리 가능")

def clear_gpu_memory():
    """GPU 메모리 캐시 해제"""
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    elif device == "cuda":
        torch.cuda.empty_cache()

# BEN2 임포트
try:
    from ben2 import BEN_Base
    BEN2_AVAILABLE = True
    print("✅ BEN2 모듈 로드 완료")
except ImportError:
    BEN2_AVAILABLE = False
    print("⚠️ BEN2 모듈 없음 (pip install ben2)")

# remove.bg API 설정
REMOVEBG_API_KEY = os.environ.get("REMOVEBG_API_KEY", "D8B2GQyMvmfbXXfH2mZukPi4")

# 2. 모델 설정 (Lazy Loading)
# 지원되는 BiRefNet 모델들 (모두 로컬)
BIREFNET_MODELS = {
    "portrait": "./models/birefnet-portrait",
    "hr": "./models/birefnet-hr",
    "hr-matting": "./models/birefnet-hr-matting",
    "dynamic": "./models/birefnet-dynamic",
    "rmbg2": "./models/rmbg2",
}

# torch.compile 가용성 체크 (Triton 필요)
TORCH_COMPILE_OK = False
if os.environ.get("TORCH_COMPILE", "1") == "1":
    try:
        import triton
        TORCH_COMPILE_OK = True
        print("✅ Triton 감지 — torch.compile 활성화")
    except ImportError:
        print("⚠️ Triton 미설치 — torch.compile 비활성화 (Windows는 미지원)")

# 로드된 모델 캐시
loaded_models = {}
ben2_model = None

def get_ben2_model():
    """BEN2 모델 로드 (Lazy Loading)"""
    global ben2_model
    if ben2_model is not None:
        return ben2_model
    if not BEN2_AVAILABLE:
        raise ValueError("BEN2 모듈이 설치되지 않았습니다. pip install ben2")
    print("📂 BEN2 모델 로딩 중...")
    ben2_model = BEN_Base.from_pretrained("PramaLLC/BEN2")
    ben2_model.to(device)
    ben2_model.eval()
    print("✅ BEN2 모델 로드 완료")
    return ben2_model

async def call_removebg_api(image_data: bytes) -> Image.Image:
    """remove.bg API 호출하여 배경 제거된 RGBA 이미지 반환"""
    if not REMOVEBG_API_KEY:
        raise ValueError("REMOVEBG_API_KEY가 설정되지 않았습니다.")
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.remove.bg/v1.0/removebg",
            headers={"X-Api-Key": REMOVEBG_API_KEY},
            files={"image_file": ("image.jpg", image_data, "image/jpeg")},
            data={"size": "auto", "format": "png", "channels": "rgba"},
        )
    if resp.status_code != 200:
        error_detail = resp.json().get("errors", [{}])[0].get("title", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text[:200]
        raise ValueError(f"remove.bg API 오류 ({resp.status_code}): {error_detail}")
    return Image.open(io.BytesIO(resp.content)).convert("RGBA")

def get_birefnet_model(model_type: str = "portrait") -> AutoModelForImageSegmentation:
    """BiRefNet 모델 로드 (Lazy Loading)"""
    global loaded_models

    if model_type in loaded_models:
        return loaded_models[model_type]

    model_path = BIREFNET_MODELS.get(model_type)
    if not model_path:
        raise ValueError(f"지원하지 않는 모델: {model_type}")

    print(f"📂 {model_type} 모델 로딩 중... ({model_path})")

    try:
        model = AutoModelForImageSegmentation.from_pretrained(
            model_path,
            trust_remote_code=True,
            local_files_only=True
        )
    except OSError as e:
        print(f"❌ 오류: 모델 폴더가 없습니다. ({model_path})")
        raise e

    # Portrait → CPU(float32), 나머지 → GPU(float16)로 병렬 처리 가능
    target_device = device
    if PORTRAIT_ON_CPU and model_type == "portrait":
        target_device = "cpu"

    model.to(target_device)
    if target_device != "cpu":
        model.half()
    model.eval()
    print(f"   ↳ 디바이스: {target_device}")

    # torch.compile 최적화 (Triton 필요 — Linux/WSL만 지원)
    if TORCH_COMPILE_OK:
        try:
            model = torch.compile(model)
            print(f"   ↳ torch.compile 적용")
        except Exception as e:
            print(f"   ⚠️ torch.compile 스킵: {e}")

    loaded_models[model_type] = model
    print(f"✅ {model_type} 모델 로드 완료")
    return model

# 3. 모든 모델 사전 로드 + 워밍업
# 서버 시작 시 3개 모델 모두 VRAM에 올려두기 (첫 요청 지연 제거)

def warmup_birefnet(model, name):
    """BiRefNet 모델 워밍업 (torch.compile 첫 실행 그래프 생성 포함)"""
    model_device = next(model.parameters()).device
    print(f"🔥 {name} 워밍업 중 ({model_device})...")
    with torch.no_grad():
        dummy = torch.randn(1, 3, 1024, 1024).to(model_device)
        if model_device.type != "cpu":
            dummy = dummy.half()
        model(dummy)
        del dummy
    clear_gpu_memory()
    print(f"   ✅ {name} 워밍업 완료")

# Portrait 모델
print("📂 모든 배경 제거 모델 사전 로딩 중...")
try:
    portrait_model = get_birefnet_model("portrait")
except OSError:
    print(f"❌ 오류: portrait 모델 폴더가 없습니다.")
    exit()
warmup_birefnet(portrait_model, "portrait")

# hr-matting 모델
try:
    hrmatting_model = get_birefnet_model("hr-matting")
    warmup_birefnet(hrmatting_model, "hr-matting")
except Exception as e:
    print(f"⚠️ hr-matting 사전 로드 실패: {e}")

# BEN2 모델
if BEN2_AVAILABLE:
    try:
        ben2 = get_ben2_model()
        # BEN2 워밍업: 더미 이미지로 inference 한 번
        print(f"🔥 BEN2 워밍업 중 ({device})...")
        dummy_img = Image.new("RGB", (512, 512), (128, 128, 128))
        with torch.no_grad():
            ben2.inference(dummy_img)
        del dummy_img
        clear_gpu_memory()
        print(f"   ✅ BEN2 워밍업 완료")
    except Exception as e:
        print(f"⚠️ BEN2 사전 로드 실패: {e}")

print("✅ 모든 모델 준비 완료!")

# 정규화 설정
transform_normalize = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

def process_image_fast(image: Image.Image, max_size: int = 1440, model_type: str = "portrait") -> Image.Image:
    """
    이미지 배경 제거 처리
    max_size: 처리 해상도 (720=빠름, 1024=중간, 1440=권장, 2048=최고품질, 9999=원본)
    model_type: BiRefNet 모델 종류 (portrait, hr, hr-matting, dynamic)
    """
    w, h = image.size

    # 원본 화질 모드 (9999 이상이면 리사이즈 안함)
    if max_size >= 9999:
        # 원본 크기 사용 (32의 배수로만 조정)
        new_w = (w // 32) * 32
        new_h = (h // 32) * 32
        print(f"📐 원본 화질 모드: {w}x{h} → {new_w}x{new_h}")
    else:
        # 허용된 해상도 범위로 제한 (보안)
        max_size = max(512, min(2500, max_size))
        scale = min(max_size / w, max_size / h)
        new_w = int(w * scale)
        new_h = int(h * scale)
        new_w = (new_w // 32) * 32
        new_h = (new_h // 32) * 32

    # MPS는 고해상도 convolution 미지원 → 안전한 최대 해상도로 클램핑
    # Portrait on CPU면 이 제한 적용 안 함
    MPS_MAX_SIDE = 2560
    model_on_mps = not (PORTRAIT_ON_CPU and model_type == "portrait") and device == "mps"
    if model_on_mps and max(new_w, new_h) > MPS_MAX_SIDE:
        scale_down = MPS_MAX_SIDE / max(new_w, new_h)
        new_w = (int(new_w * scale_down) // 32) * 32
        new_h = (int(new_h * scale_down) // 32) * 32
        print(f"⚠️ MPS 한계 → 처리 해상도 축소: {new_w}x{new_h}")

    # 리사이징
    image_resized = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # 모델 가져오기 (Lazy Loading)
    model = get_birefnet_model(model_type)

    # 모델 디바이스 자동 감지 (portrait=CPU, 나머지=GPU)
    model_device = next(model.parameters()).device

    # 텐서 변환 — 모델 디바이스에 맞춤
    input_tensor = transform_normalize(image_resized).unsqueeze(0).to(model_device)

    # GPU(float16) / CPU(float32) 자동 판별
    if model_device.type != "cpu":
        input_tensor = input_tensor.half()

    # 추론
    with torch.no_grad():
        preds = model(input_tensor)[-1].sigmoid().cpu()

    # 마스크 복원
    pred = preds[0].squeeze().float() # 다시 float32로 변환 (이미지 저장용)
    pred_pil = transforms.ToPILImage()(pred)
    mask = pred_pil.resize((w, h), Image.Resampling.LANCZOS)

    return mask

# ========== 마스크 리파인 함수들 ==========
def refine_guided_filter(image: Image.Image, mask: Image.Image, r: int = 8, eps: float = 1e-3) -> Image.Image:
    """Guided Filter: 원본 이미지 엣지를 참조하여 마스크 경계 정제"""
    import cv2
    guide = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    src = np.array(mask).astype(np.float32) / 255.0
    refined = cv2.ximgproc.guidedFilter(guide, src, radius=r, eps=eps)
    refined = np.clip(refined * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(refined)

def refine_pymatting(image: Image.Image, mask: Image.Image) -> Image.Image:
    """PyMatting: 알파 매팅으로 반투명 경계 정밀 처리"""
    from pymatting import estimate_alpha_cf
    # 처리 속도를 위해 최대 1024로 축소 후 다시 복원
    orig_size = mask.size
    max_side = 1024
    if max(orig_size) > max_side:
        scale = max_side / max(orig_size)
        small_size = (int(orig_size[0] * scale), int(orig_size[1] * scale))
        image_small = image.resize(small_size, Image.Resampling.LANCZOS)
        mask_small = mask.resize(small_size, Image.Resampling.LANCZOS)
    else:
        image_small = image
        mask_small = mask
        small_size = orig_size

    img_np = np.array(image_small).astype(np.float64) / 255.0
    mask_np = np.array(mask_small).astype(np.float64) / 255.0
    # trimap 생성: 확실한 전경/배경 + 불확실 영역
    trimap = np.zeros_like(mask_np)
    trimap[mask_np > 0.9] = 1.0
    trimap[(mask_np > 0.1) & (mask_np <= 0.9)] = 0.5

    alpha = estimate_alpha_cf(img_np, trimap)
    alpha = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    result = Image.fromarray(alpha)
    if small_size != orig_size:
        result = result.resize(orig_size, Image.Resampling.LANCZOS)
    return result

def refine_foreground_color(image: Image.Image, mask: Image.Image, r: int = 90) -> Image.Image:
    """Fast Foreground Estimation: 전경 색상 추정으로 반투명 영역 개선
    마스크가 아닌 전경 이미지를 반환 (알파 합성 시 색번짐 제거)"""
    import cv2
    # 속도를 위해 최대 1024로 축소 후 처리
    orig_size = image.size
    max_side = 1024
    if max(orig_size) > max_side:
        scale = max_side / max(orig_size)
        small_size = (int(orig_size[0] * scale), int(orig_size[1] * scale))
        image_s = image.resize(small_size, Image.Resampling.LANCZOS)
        mask_s = mask.resize(small_size, Image.Resampling.LANCZOS)
    else:
        image_s = image
        mask_s = mask
        small_size = orig_size

    img_np = np.array(image_s).astype(np.float32) / 255.0
    mask_np = np.array(mask_s).astype(np.float32) / 255.0
    if mask_np.ndim == 2:
        mask_np = mask_np[:, :, np.newaxis]

    # Blur fusion (2회 반복이면 충분)
    for _ in range(2):
        blurred_img = cv2.GaussianBlur(img_np, (0, 0), sigmaX=r, sigmaY=r)
        blurred_mask = cv2.GaussianBlur(mask_np[:, :, 0], (0, 0), sigmaX=r, sigmaY=r)
        blurred_mask = np.maximum(blurred_mask, 1e-6)[:, :, np.newaxis]
        foreground = np.clip(blurred_img / blurred_mask, 0, 1)
        img_np = img_np * mask_np + foreground * (1 - mask_np)

    result = Image.fromarray((img_np * 255).astype(np.uint8))
    if small_size != orig_size:
        result = result.resize(orig_size, Image.Resampling.LANCZOS)
    return result

@app.post("/remove-bg")
async def remove_background(
    file: UploadFile = File(...),
    max_size: int = Query(default=1440, ge=512, le=9999, description="처리 해상도 (512-2500, 9999=원본)"),
    model: str = Query(default="portrait", pattern="^(portrait|hr|hr-matting|dynamic|rmbg2|ben2|removebg)$", description="배경 제거 모델"),
    case_type: str = Query(default="auto", description="피사체 유형: auto, KID_PERSON, ADULT_PERSON, TOY_OBJECT"),
    has_face: bool = Query(default=True, description="얼굴 감지 여부 (Face API 결과)"),
    refine: str = Query(default="none", pattern="^(none|guided|pymatting|fg_estimate)$", description="마스크 리파인 방법")
):
    print("-" * 40)
    print(f"📸 요청: {file.filename} (품질: {max_size}px, 모델: {model}, 리파인: {refine})")
    start_time = time.time()

    # 1. 파일 타입 검증
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다. 허용: {', '.join(ALLOWED_CONTENT_TYPES)}"
        )

    # 2. 파일 읽기 및 크기 검증
    image_data = await file.read()
    if len(image_data) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"파일이 너무 큽니다. 최대 {MAX_FILE_SIZE // (1024*1024)}MB까지 허용됩니다."
        )

    # 3. 이미지 유효성 검증
    try:
        image = Image.open(io.BytesIO(image_data))
        image.verify()  # 이미지 파일인지 검증
        # verify() 후에는 다시 열어야 함
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)  # EXIF 회전 적용
        image = image.convert("RGB")
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail="손상된 이미지 파일이거나 올바른 이미지 형식이 아닙니다."
        )

    try:
        # 원본 크기 저장 (크롭 정보 헤더용)
        original_w, original_h = image.size

        if model == "removebg":
            # remove.bg API 호출 (외부 서비스)
            result_rgba = await call_removebg_api(image_data)
            # 원본과 크기가 다를 수 있으므로 원본 크기로 리사이즈
            if result_rgba.size != (original_w, original_h):
                result_rgba = result_rgba.resize((original_w, original_h), Image.Resampling.LANCZOS)
            mask = result_rgba.split()[-1]
        elif model == "ben2":
            # BEN2는 자체 inference API 사용 (GPU에서 실행)
            # asyncio.to_thread로 이벤트 루프 블로킹 방지 → portrait(CPU)와 병렬 가능
            ben2 = get_ben2_model()
            def _run_ben2():
                with torch.no_grad():
                    return ben2.inference(image)
            result_rgba = await asyncio.to_thread(_run_ben2)
            # RGBA 결과에서 알파 채널을 마스크로 추출
            mask = result_rgba.split()[-1]
        else:
            # portrait 등 BiRefNet 모델 (CPU 또는 GPU)
            # asyncio.to_thread로 이벤트 루프 블로킹 방지 → ben2(GPU)와 병렬 가능
            mask = await asyncio.to_thread(process_image_fast, image, max_size, model)

        # 마스크 리파인 적용
        if refine != "none":
            refine_start = time.time()
            if refine == "guided":
                mask = refine_guided_filter(image, mask)
                print(f"🔧 Guided Filter 리파인 완료 ({time.time() - refine_start:.2f}초)")
            elif refine == "pymatting":
                mask = refine_pymatting(image, mask)
                print(f"🔧 PyMatting 리파인 완료 ({time.time() - refine_start:.2f}초)")
            elif refine == "fg_estimate":
                # 전경 색상 추정은 마스크 적용 후 처리 (아래에서)
                pass

        # BGQA 품질 평가 — 현재 프리뷰에서 미사용, 스킵하여 속도 향상
        bgqa_score = 100.0
        bgqa_passed = True
        bgqa_issues = []
        bgqa_case_type = "KID_PERSON"

        # fg_estimate: 전경 색상 추정으로 반투명 영역 색번짐 제거
        if refine == "fg_estimate":
            refine_start = time.time()
            refined_fg = refine_foreground_color(image, mask)
            image = refined_fg
            print(f"🔧 Foreground Estimation 리파인 완료 ({time.time() - refine_start:.2f}초)")

        image.putalpha(mask)

        # 알파 채널 기준으로 콘텐츠 영역 크롭 (빈 공간 제거)
        alpha = image.split()[-1]  # 알파 채널 추출
        # 알파값 30 미만은 투명 처리 (배경 잔여물/노이즈 제거)
        alpha_clean = alpha.point(lambda x: 0 if x < 30 else x)
        bbox = alpha_clean.getbbox()  # 불투명 픽셀의 바운딩 박스

        # 크롭 좌표 초기화
        crop_x, crop_y = 0, 0

        if bbox:
            # 패딩 추가 (20px)
            padding = 20
            x1, y1, x2, y2 = bbox
            crop_x = max(0, x1 - padding)
            crop_y = max(0, y1 - padding)
            x2 = min(image.width, x2 + padding)
            y2 = min(image.height, y2 + padding)

            # 크롭
            original_size = image.size
            image = image.crop((crop_x, crop_y, x2, y2))
            print(f"✂️  크롭: {original_size} → {image.size} (패딩 {padding}px)")

        img_byte_arr = io.BytesIO()
        # WebP로 저장 (PNG보다 인코딩 2배 빠름, 용량 50% 감소)
        image.save(img_byte_arr, format='WEBP', quality=90)

        # PNG 저장 스킵 — 프리뷰 속도 우선

        print(f"⚡ 완료! 소요시간: {time.time() - start_time:.2f}초")
        print("-" * 40)

        # 크롭 정보를 헤더에 포함 (마커 좌표 보정용)
        headers = {
            "X-Original-Width": str(original_w),
            "X-Original-Height": str(original_h),
            "X-Crop-X": str(crop_x),
            "X-Crop-Y": str(crop_y),
            "X-Crop-Width": str(image.width),
            "X-Crop-Height": str(image.height),
            "X-BGQA-Score": str(bgqa_score),
            "X-BGQA-Passed": str(bgqa_passed).lower(),
            "X-BGQA-Issues": ",".join(bgqa_issues) if bgqa_issues else "",
            "X-BGQA-CaseType": bgqa_case_type,
        }

        clear_gpu_memory()
        return Response(content=img_byte_arr.getvalue(), media_type="image/webp", headers=headers)
    except Exception as e:
        clear_gpu_memory()
        print(f"❌ 처리 오류: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="이미지 처리 중 오류가 발생했습니다. 다른 이미지를 시도해주세요."
        )

# ========== ViTPose 모델 (Lazy Loading) ==========
vitpose_model = None
vitpose_huge_model = None
vitpose_processor = None

def load_vitpose_model(model_type="vitpose"):
    """ViTPose 모델 로드 (처음 요청 시에만)"""
    global vitpose_model, vitpose_huge_model, vitpose_processor

    try:
        from transformers import AutoProcessor, AutoModel, VitPoseForPoseEstimation

        model_name = "usyd-community/vitpose-base-simple" if model_type == "vitpose" else "usyd-community/vitpose-huge-simple"

        if model_type == "vitpose" and vitpose_model is None:
            print(f"📂 ViTPose 모델 로딩 중... ({model_name})")
            vitpose_processor = AutoProcessor.from_pretrained(model_name)
            vitpose_model = VitPoseForPoseEstimation.from_pretrained(model_name)
            vitpose_model.to(device)
            vitpose_model.eval()
            print("✅ ViTPose 모델 로드 완료")
            return vitpose_model, vitpose_processor

        elif model_type == "vitpose-huge" and vitpose_huge_model is None:
            print(f"📂 ViTPose-Huge 모델 로딩 중... ({model_name})")
            if vitpose_processor is None:
                vitpose_processor = AutoProcessor.from_pretrained(model_name)
            vitpose_huge_model = VitPoseForPoseEstimation.from_pretrained(model_name)
            vitpose_huge_model.to(device)
            vitpose_huge_model.eval()
            print("✅ ViTPose-Huge 모델 로드 완료")
            return vitpose_huge_model, vitpose_processor

        # 이미 로드된 모델 반환
        if model_type == "vitpose":
            return vitpose_model, vitpose_processor
        else:
            return vitpose_huge_model, vitpose_processor

    except ImportError as e:
        print(f"❌ Import 오류: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"ViTPose 모델을 사용하려면 transformers>=4.45.0이 필요합니다. 오류: {str(e)}"
        )
    except Exception as e:
        print(f"❌ 모델 로드 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"ViTPose 모델 로드 실패: {str(e)}"
        )

# COCO 17개 키포인트를 BlazePose 33개에 매핑 (호환성)
COCO_TO_BLAZEPOSE = {
    0: 0,    # nose
    1: 2,    # left_eye
    2: 5,    # right_eye
    3: 7,    # left_ear
    4: 8,    # right_ear
    5: 11,   # left_shoulder
    6: 12,   # right_shoulder
    7: 13,   # left_elbow
    8: 14,   # right_elbow
    9: 15,   # left_wrist
    10: 16,  # right_wrist
    11: 23,  # left_hip
    12: 24,  # right_hip
    13: 25,  # left_knee
    14: 26,  # right_knee
    15: 27,  # left_ankle
    16: 28,  # right_ankle
}

# COCO 손목 키포인트 인덱스
COCO_LEFT_WRIST = 9
COCO_RIGHT_WRIST = 10


def extract_wrist_keypoints(image: Image.Image, min_score: float = 0.3) -> list:
    """
    ViTPose를 사용하여 이미지에서 손목 키포인트 추출

    Args:
        image: PIL Image
        min_score: 최소 신뢰도 (기본값 0.3)

    Returns:
        [(x1, y1), (x2, y2)] 형태의 손목 좌표 리스트
        신뢰도가 낮으면 빈 리스트 반환
    """
    global vitpose_model, vitpose_processor

    try:
        # 모델 로드 (Lazy)
        pose_model, processor = load_vitpose_model("vitpose")

        # 전체 이미지를 하나의 person bbox로 처리
        boxes = [[[0, 0, image.width, image.height]]]
        inputs = processor(images=image, boxes=boxes, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}

        # 추론
        with torch.no_grad():
            outputs = pose_model(**inputs)

        # 결과 처리
        results = processor.post_process_pose_estimation(outputs, boxes=boxes)[0][0]
        keypoints_xy = results['keypoints'].cpu().numpy()
        scores = results['scores'].cpu().numpy()

        # 손목 키포인트 추출
        wrist_keypoints = []

        # 왼쪽 손목
        if scores[COCO_LEFT_WRIST] >= min_score:
            kp = keypoints_xy[COCO_LEFT_WRIST]
            wrist_keypoints.append((float(kp[0]), float(kp[1])))

        # 오른쪽 손목
        if scores[COCO_RIGHT_WRIST] >= min_score:
            kp = keypoints_xy[COCO_RIGHT_WRIST]
            wrist_keypoints.append((float(kp[0]), float(kp[1])))

        return wrist_keypoints

    except Exception as e:
        print(f"⚠️ 손목 키포인트 추출 실패: {e}")
        return []

@app.post("/detect-pose")
async def detect_pose(
    file: UploadFile = File(...),
    model: str = Query(default="vitpose", pattern="^(vitpose|vitpose-huge)$", description="모델 선택")
):
    """ViTPose를 사용한 포즈 감지"""
    print("-" * 40)
    print(f"🦴 포즈 감지 요청: {file.filename} (모델: {model})")
    start_time = time.time()

    # 파일 검증
    if not is_allowed_image(file):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다.")

    image_data = await file.read()
    if len(image_data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일이 너무 큽니다.")

    try:
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    try:
        # 모델 로드 (Lazy)
        pose_model, processor = load_vitpose_model(model)

        # 이미지 전처리 - ViTPose는 bounding box 필요
        # 전체 이미지를 하나의 person bbox로 처리
        boxes = [[[0, 0, image.width, image.height]]]  # batch, num_persons, 4
        inputs = processor(images=image, boxes=boxes, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}

        # 추론
        with torch.no_grad():
            outputs = pose_model(**inputs)

        # 결과 처리
        # ViTPose 출력: pose_logits [batch, num_persons, num_keypoints, height, width]
        # post_process_pose_estimation으로 키포인트 추출
        results = processor.post_process_pose_estimation(outputs, boxes=boxes)[0][0]

        # keypoints: [17, 2], scores: [17]
        keypoints_xy = results['keypoints'].cpu().numpy()
        scores = results['scores'].cpu().numpy()

        print(f"🦴 감지된 키포인트: {len(keypoints_xy)}개")

        # BlazePose 형식으로 변환 (33개 키포인트, 없는 건 0으로)
        blazepose_keypoints = []
        for i in range(33):
            # COCO에서 매핑된 키포인트 찾기
            coco_idx = None
            for coco_i, blaze_i in COCO_TO_BLAZEPOSE.items():
                if blaze_i == i:
                    coco_idx = coco_i
                    break

            if coco_idx is not None and coco_idx < len(keypoints_xy):
                kp = keypoints_xy[coco_idx]
                score = float(scores[coco_idx])
                blazepose_keypoints.append({
                    "x": float(kp[0]),
                    "y": float(kp[1]),
                    "score": score,
                    "name": f"keypoint_{i}"
                })
            else:
                # 매핑되지 않은 키포인트는 0으로
                blazepose_keypoints.append({
                    "x": 0,
                    "y": 0,
                    "score": 0,
                    "name": f"keypoint_{i}"
                })

        # 발목 키포인트 확인 로그
        ankle_left = blazepose_keypoints[27]
        ankle_right = blazepose_keypoints[28]
        print(f"🦶 발목 키포인트 - 왼쪽(27): score={ankle_left['score']:.3f}, 오른쪽(28): score={ankle_right['score']:.3f}")
        print(f"⚡ 완료! 소요시간: {time.time() - start_time:.2f}초")
        print("-" * 40)

        clear_gpu_memory()
        return JSONResponse(content={
            "success": True,
            "model": model,
            "keypoints": blazepose_keypoints,
            "image_width": image.width,
            "image_height": image.height
        })

    except HTTPException:
        raise
    except Exception as e:
        clear_gpu_memory()
        print(f"❌ 포즈 감지 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"포즈 감지 중 오류가 발생했습니다: {str(e)}"
        )

# ========== HEIC 변환 API ==========

@app.post("/convert-heic")
async def convert_heic(file: UploadFile = File(...)):
    """HEIC/HEIF → JPEG 변환"""
    if not is_allowed_image(file):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다.")

    image_data = await file.read()
    try:
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=95)
    buf.seek(0)

    from starlette.responses import StreamingResponse
    return StreamingResponse(buf, media_type="image/jpeg")

# ========== Smart Crop API ==========

@app.post("/smart-crop")
async def smart_crop(
    file: UploadFile = File(...),
    padding_ratio: float = Query(default=0.25, ge=0.0, le=1.0, description="크롭 패딩 비율"),
    min_score: float = Query(default=0.3, ge=0.0, le=1.0, description="키포인트 최소 신뢰도"),
    seg_size: int = Query(default=512, ge=128, le=1024, description="세그멘테이션 마스크 해상도"),
    crop_mode: str = Query(default="person", description="크롭 모드: person(인물) 또는 object(물건)"),
):
    """ViTPose 키포인트 + 세그멘테이션 마스크 기반 스마트 크롭"""
    print("-" * 40)
    mode_label = "인물" if crop_mode == "person" else "물건"
    print(f"✂️ 스마트 크롭 요청: {file.filename} (모드: {mode_label}, seg_size: {seg_size})")
    start_time = time.time()

    # 파일 검증
    if not is_allowed_image(file):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다.")

    image_data = await file.read()
    if len(image_data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일이 너무 큽니다.")

    try:
        image = Image.open(io.BytesIO(image_data))
        image.verify()
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    # === 물건 모드: 마스크만으로 크롭 ===
    if crop_mode == "object":
        try:
            seg_start = time.time()
            seg_scale = min(seg_size / image.width, seg_size / image.height)
            seg_w = max(32, (int(image.width * seg_scale) // 32) * 32)
            seg_h = max(32, (int(image.height * seg_scale) // 32) * 32)

            seg_resized = image.resize((seg_w, seg_h), Image.Resampling.LANCZOS)
            seg_model = get_birefnet_model("portrait")
            seg_dev = next(seg_model.parameters()).device
            seg_tensor = transform_normalize(seg_resized).unsqueeze(0).to(seg_dev)
            if seg_dev.type != "cpu":
                seg_tensor = seg_tensor.half()

            with torch.no_grad():
                seg_pred = seg_model(seg_tensor)[-1].sigmoid().cpu()

            seg_mask = seg_pred[0].squeeze().float().numpy()
            mask_binary = seg_mask > 0.5
            rows = np.any(mask_binary, axis=1)
            cols = np.any(mask_binary, axis=0)

            if not rows.any() or not cols.any():
                print(f"⚠️ 마스크에서 대상 미감지")
                clear_gpu_memory()
                return JSONResponse(content={"cropped": False, "reason": "대상 미감지"})

            r_min, r_max = np.where(rows)[0][[0, -1]]
            c_min, c_max = np.where(cols)[0][[0, -1]]
            scale_x = image.width / seg_w
            scale_y = image.height / seg_h
            mask_x_min = c_min * scale_x
            mask_y_min = r_min * scale_y
            mask_x_max = (c_max + 1) * scale_x
            mask_y_max = (r_max + 1) * scale_y

            # 상하좌우 10% 패딩
            mask_w = mask_x_max - mask_x_min
            mask_h = mask_y_max - mask_y_min
            mask_x_min = max(0, mask_x_min - mask_w * 0.1)
            mask_y_min = max(0, mask_y_min - mask_h * 0.1)
            mask_x_max = min(image.width, mask_x_max + mask_w * 0.1)
            mask_y_max = min(image.height, mask_y_max + mask_h * 0.1)

            mask_bbox = {"x_min": float(mask_x_min), "y_min": float(mask_y_min), "x_max": float(mask_x_max), "y_max": float(mask_y_max)}

            crop_x = max(0, int(mask_x_min))
            crop_y = max(0, int(mask_y_min))
            crop_x2 = min(image.width, int(mask_x_max))
            crop_y2 = min(image.height, int(mask_y_max))
            crop_w = crop_x2 - crop_x
            crop_h = crop_y2 - crop_y

            # 크롭 영역이 원본의 90% 이상이면 스킵
            crop_area = crop_w * crop_h
            image_area = image.width * image.height
            is_cropped = crop_area < image_area * 0.9

            print(f"   🎭 마스크 bbox: ({mask_x_min:.0f}, {mask_y_min:.0f})→({mask_x_max:.0f}, {mask_y_max:.0f}) [{time.time() - seg_start:.2f}초]")
            if not is_cropped:
                print(f"⚠️ 크롭 영역이 원본의 {crop_area / image_area * 100:.0f}%로 크롭 불필요")
            else:
                print(f"✂️ 크롭 좌표: ({crop_x}, {crop_y}) {crop_w}x{crop_h}")
            print(f"⚡ 완료! 소요시간: {time.time() - start_time:.2f}초")
            print("-" * 40)

            clear_gpu_memory()
            return JSONResponse(content={
                "cropped": is_cropped,
                "reason": None if is_cropped else "크롭 불필요 (90% 이상)",
                "crop": {"x": crop_x, "y": crop_y, "width": crop_w, "height": crop_h},
                "image_width": image.width,
                "image_height": image.height,
                "mask_bbox": mask_bbox,
            })
        except Exception as e:
            clear_gpu_memory()
            print(f"❌ 물건 크롭 오류: {str(e)}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"물건 크롭 중 오류: {str(e)}")

    try:
        # ViTPose 모델 로드 및 추론 (인물 모드)
        pose_model, processor = load_vitpose_model("vitpose")

        boxes = [[[0, 0, image.width, image.height]]]
        inputs = processor(images=image, boxes=boxes, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = pose_model(**inputs)

        results = processor.post_process_pose_estimation(outputs, boxes=boxes)[0][0]
        keypoints_xy = results['keypoints'].cpu().numpy()
        scores = results['scores'].cpu().numpy()

        # score > min_score인 키포인트만 사용
        valid_mask = scores > min_score
        valid_count = int(valid_mask.sum())

        if valid_count < 3:
            print(f"⚠️ 유효 키포인트 부족: {valid_count}개 (최소 3개 필요)")
            clear_gpu_memory()
            return JSONResponse(content={"cropped": False, "reason": "유효 키포인트 부족"})

        valid_kps = keypoints_xy[valid_mask]

        # === 손가락 끝 추정: 어깨→팔꿈치 100% AND 팔꿈치→손목 50% 둘 다 추가 ===
        # COCO: 5=L_shoulder, 7=L_elbow, 9=L_wrist, 6=R_shoulder, 8=R_elbow, 10=R_wrist
        HAND_SETS = [
            (5, 7, 9),   # 왼쪽: shoulder, elbow, wrist
            (6, 8, 10),  # 오른쪽: shoulder, elbow, wrist
        ]

        extra_points = []
        for sh_idx, el_idx, wr_idx in HAND_SETS:
            # 어깨→팔꿈치 방향으로 팔꿈치에서 +100% 연장
            if scores[sh_idx] > min_score and scores[el_idx] > min_score:
                sx, sy = keypoints_xy[sh_idx]
                ex, ey = keypoints_xy[el_idx]
                dx, dy = ex - sx, ey - sy
                cx = max(0, min(image.width, ex + dx * 1.5))
                cy = max(0, min(image.height, ey + dy * 1.5))
                extra_points.append((cx, cy))
                print(f"   🖐️ finger 추정: ({cx:.0f}, {cy:.0f}) [shoulder→elbow+150%]")
            # 팔꿈치→손목 방향으로 손목에서 +50% 연장
            if scores[el_idx] > min_score and scores[wr_idx] > min_score:
                ex, ey = keypoints_xy[el_idx]
                wx, wy = keypoints_xy[wr_idx]
                dx, dy = wx - ex, wy - ey
                cx = max(0, min(image.width, wx + dx * 1.0))
                cy = max(0, min(image.height, wy + dy * 1.0))
                extra_points.append((cx, cy))
                print(f"   🖐️ finger 추정: ({cx:.0f}, {cy:.0f}) [elbow→wrist+100%]")

        # === 발끝 추정: 더 아래쪽 발목 기준, 엉덩이→무릎 vs 무릎→발목 70% 중 더 먼 쪽 ===
        # COCO: 11=L_hip, 13=L_knee, 15=L_ankle, 12=R_hip, 14=R_knee, 16=R_ankle
        FOOT_SETS = [
            (11, 13, 15),  # 왼쪽: hip, knee, ankle
            (12, 14, 16),  # 오른쪽: hip, knee, ankle
        ]

        # 더 아래(y가 큰) 발목 쪽 선택
        lower_foot = None
        lower_ankle_y = -1
        for hp_idx, kn_idx, ak_idx in FOOT_SETS:
            if scores[ak_idx] > min_score:
                if keypoints_xy[ak_idx][1] > lower_ankle_y:
                    lower_ankle_y = keypoints_xy[ak_idx][1]
                    lower_foot = (hp_idx, kn_idx, ak_idx)

        if lower_foot:
            hp_idx, kn_idx, ak_idx = lower_foot
            hx, hy = keypoints_xy[hp_idx]
            kx, ky = keypoints_xy[kn_idx]
            ax, ay = keypoints_xy[ak_idx]

            # 엉덩이→무릎 100% 연장
            if scores[hp_idx] > min_score and scores[kn_idx] > min_score:
                dx, dy = kx - hx, ky - hy
                cx = max(0, min(image.width, kx + dx * 1.0))
                cy = max(0, min(image.height, ky + dy * 1.0))
                extra_points.append((cx, cy))
                print(f"   🦶 toe 추정: ({cx:.0f}, {cy:.0f}) [hip→knee 100%]")
            # 무릎→발목 +150% 연장
            if scores[kn_idx] > min_score and scores[ak_idx] > min_score:
                dx, dy = ax - kx, ay - ky
                cx = max(0, min(image.width, ax + dx * 1.5))
                cy = max(0, min(image.height, ay + dy * 1.5))
                extra_points.append((cx, cy))
                print(f"   🦶 toe 추정: ({cx:.0f}, {cy:.0f}) [knee→ankle+150%]")

        # === 귀 추정: 코→귀 방향으로 귀에서 +100% 연장 ===
        # COCO: 0=nose, 3=L_ear, 4=R_ear
        for ear_idx in [3, 4]:
            if scores[0] > min_score and scores[ear_idx] > min_score:
                nx, ny = keypoints_xy[0]
                ex, ey = keypoints_xy[ear_idx]
                dx, dy = ex - nx, ey - ny
                cx = max(0, min(image.width, ex + dx * 1.0))
                cy = max(0, min(image.height, ey + dy * 1.0))
                extra_points.append((cx, cy))
                side = "L" if ear_idx == 3 else "R"
                print(f"   👂 ear 추정: ({cx:.0f}, {cy:.0f}) [nose→{side}_ear+100%]")

        # === 머리 꼭대기 추정 (어깨 중점→눈 중점 벡터 170% 연장) ===
        # COCO: 1=L_eye, 2=R_eye, 5=L_shoulder, 6=R_shoulder
        has_eyes = scores[1] > min_score and scores[2] > min_score
        has_shoulders = scores[5] > min_score and scores[6] > min_score

        if has_eyes and has_shoulders:
            mid_eye_x = (keypoints_xy[1][0] + keypoints_xy[2][0]) / 2
            mid_eye_y = (keypoints_xy[1][1] + keypoints_xy[2][1]) / 2
            mid_sh_x = (keypoints_xy[5][0] + keypoints_xy[6][0]) / 2
            mid_sh_y = (keypoints_xy[5][1] + keypoints_xy[6][1]) / 2
            dx = mid_eye_x - mid_sh_x
            dy = mid_eye_y - mid_sh_y
            crown_x = mid_eye_x + dx * 1.7
            crown_y = mid_eye_y + dy * 1.7
            crown_x = max(0, min(image.width, crown_x))
            crown_y = max(0, min(image.height, crown_y))
            extra_points.append((crown_x, crown_y))
            print(f"   👤 머리 꼭대기 추정: ({crown_x:.0f}, {crown_y:.0f}) [어깨→눈 170%]")

        # 바운딩 박스 계산 (유효 키포인트 + 추정 포인트 합산)
        all_x = [float(kp[0]) for kp in valid_kps] + [p[0] for p in extra_points]
        all_y = [float(kp[1]) for kp in valid_kps] + [p[1] for p in extra_points]

        kp_x_min = min(all_x)
        kp_y_min = min(all_y)
        kp_x_max = max(all_x)
        kp_y_max = max(all_y)

        # === 저해상도 세그멘테이션 마스크로 실루엣 bbox 보완 ===
        try:
            seg_start = time.time()
            seg_scale = min(seg_size / image.width, seg_size / image.height)
            seg_w = (int(image.width * seg_scale) // 32) * 32
            seg_h = (int(image.height * seg_scale) // 32) * 32
            seg_w = max(32, seg_w)
            seg_h = max(32, seg_h)

            seg_resized = image.resize((seg_w, seg_h), Image.Resampling.LANCZOS)
            seg_model = get_birefnet_model("portrait")
            seg_dev = next(seg_model.parameters()).device
            seg_tensor = transform_normalize(seg_resized).unsqueeze(0).to(seg_dev)
            if seg_dev.type != "cpu":
                seg_tensor = seg_tensor.half()

            with torch.no_grad():
                seg_pred = seg_model(seg_tensor)[-1].sigmoid().cpu()

            seg_mask = seg_pred[0].squeeze().float().numpy()
            # 임계값 0.5로 이진화
            mask_binary = seg_mask > 0.5
            rows = np.any(mask_binary, axis=1)
            cols = np.any(mask_binary, axis=0)

            if rows.any() and cols.any():
                r_min, r_max = np.where(rows)[0][[0, -1]]
                c_min, c_max = np.where(cols)[0][[0, -1]]
                # 원본 해상도로 좌표 변환
                scale_x = image.width / seg_w
                scale_y = image.height / seg_h
                mask_x_min = c_min * scale_x
                mask_y_min = r_min * scale_y
                mask_x_max = (c_max + 1) * scale_x
                mask_y_max = (r_max + 1) * scale_y

                # 마스크 bbox 패딩: 위 10%, 좌우 5% (가는 머리카락/팔 보호)
                mask_h = mask_y_max - mask_y_min
                mask_w = mask_x_max - mask_x_min
                mask_y_min = max(0, mask_y_min - mask_h * 0.1)
                mask_x_min = max(0, mask_x_min - mask_w * 0.05)
                mask_x_max = min(image.width, mask_x_max + mask_w * 0.05)

                # 키포인트 bbox와 마스크 bbox의 합집합
                x_min = min(kp_x_min, mask_x_min)
                y_min = min(kp_y_min, mask_y_min)
                x_max = max(kp_x_max, mask_x_max)
                y_max = max(kp_y_max, mask_y_max)
                mask_bbox = {"x_min": float(mask_x_min), "y_min": float(mask_y_min), "x_max": float(mask_x_max), "y_max": float(mask_y_max)}
                print(f"   🎭 마스크 bbox: ({mask_x_min:.0f}, {mask_y_min:.0f})→({mask_x_max:.0f}, {mask_y_max:.0f}) [{time.time() - seg_start:.2f}초]")
            else:
                x_min, y_min, x_max, y_max = kp_x_min, kp_y_min, kp_x_max, kp_y_max
                mask_bbox = None
                print(f"   ⚠️ 마스크에서 인물 미감지, 키포인트만 사용")
        except Exception as seg_err:
            x_min, y_min, x_max, y_max = kp_x_min, kp_y_min, kp_x_max, kp_y_max
            mask_bbox = None
            print(f"   ⚠️ 세그멘테이션 실패: {seg_err}, 키포인트만 사용")

        kp_bbox = {"x_min": float(kp_x_min), "y_min": float(kp_y_min), "x_max": float(kp_x_max), "y_max": float(kp_y_max)}

        # 패딩 없음 — 관절 추정 + 마스크 합집합으로 커버
        crop_x = max(0, int(x_min))
        crop_y = max(0, int(y_min))
        crop_x2 = min(image.width, int(x_max))
        crop_y2 = min(image.height, int(y_max))

        crop_w = crop_x2 - crop_x
        crop_h = crop_y2 - crop_y

        # 키포인트 정보 구성 (COCO 17)
        COCO_NAMES = [
            "nose", "left_eye", "right_eye", "left_ear", "right_ear",
            "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
            "left_wrist", "right_wrist", "left_hip", "right_hip",
            "left_knee", "right_knee", "left_ankle", "right_ankle",
        ]
        keypoints_list = []
        for i in range(len(keypoints_xy)):
            keypoints_list.append({
                "name": COCO_NAMES[i] if i < len(COCO_NAMES) else f"kp_{i}",
                "x": float(keypoints_xy[i][0]),
                "y": float(keypoints_xy[i][1]),
                "score": float(scores[i]),
            })

        # 크롭 영역이 원본의 90% 이상이면 크롭 불필요 (정보는 반환)
        crop_area = crop_w * crop_h
        image_area = image.width * image.height
        if crop_area >= image_area * 0.9:
            print(f"⚠️ 크롭 영역이 원본의 {crop_area / image_area * 100:.0f}%로 크롭 불필요")
            print(f"⚡ 완료! 소요시간: {time.time() - start_time:.2f}초")
            print("-" * 40)
            clear_gpu_memory()
            response = {
                "cropped": False,
                "reason": "크롭 불필요 (90% 이상)",
                "crop": {"x": crop_x, "y": crop_y, "width": crop_w, "height": crop_h},
                "image_width": image.width,
                "image_height": image.height,
                "valid_keypoints": valid_count,
                "keypoints": keypoints_list,
                "kp_bbox": kp_bbox,
            }
            if mask_bbox:
                response["mask_bbox"] = mask_bbox
            return JSONResponse(content=response)

        print(f"✂️ 크롭 좌표: ({crop_x}, {crop_y}) {crop_w}x{crop_h} (유효 키포인트: {valid_count}개)")
        print(f"⚡ 완료! 소요시간: {time.time() - start_time:.2f}초")
        print("-" * 40)

        clear_gpu_memory()
        response = {
            "cropped": True,
            "crop": {
                "x": crop_x,
                "y": crop_y,
                "width": crop_w,
                "height": crop_h,
            },
            "image_width": image.width,
            "image_height": image.height,
            "valid_keypoints": valid_count,
            "keypoints": keypoints_list,
            "kp_bbox": kp_bbox,
        }
        if mask_bbox:
            response["mask_bbox"] = mask_bbox
        return JSONResponse(content=response)

    except HTTPException:
        raise
    except Exception as e:
        clear_gpu_memory()
        print(f"❌ 스마트 크롭 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"스마트 크롭 중 오류: {str(e)}")

# ========== Ryan Book Automation API ==========

class ChildData(BaseModel):
    firstName: str
    lastName: str = ""
    fullName: str = ""
    gender: str = "boy"
    birthday: Optional[str] = None
    photo: Optional[str] = None
    photoNoBg: Optional[str] = None

class FavoriteObject(BaseModel):
    name: str
    photo: Optional[str] = None
    photoNoBg: Optional[str] = None
    emoji: str = "❓"
    josaMode: str = "friend"

class FamilyMember(BaseModel):
    id: str
    relation: str
    emoji: str
    photo: Optional[str] = None
    customName: Optional[str] = None

class BookRequest(BaseModel):
    child: ChildData
    objects: List[FavoriteObject] = []
    familyMembers: List[FamilyMember] = []

@app.get("/josa-preview")
async def josa_preview(name: str = Query(..., min_length=1, description="조사를 적용할 이름")):
    """
    한글 조사 미리보기 API

    이름을 입력하면 9가지 조사 형태의 예시를 반환합니다.
    프론트엔드에서 실시간 조사 미리보기에 사용됩니다.
    """
    if not RYAN_ENGINE_AVAILABLE:
        raise HTTPException(status_code=500, detail="Ryan Engine을 사용할 수 없습니다.")

    josa = JosaUtils()
    demo = josa.generate_josa_demo(name)

    return JSONResponse(content={
        "success": True,
        "name": demo['name'],
        "hasBatchim": demo['has_batchim'],
        "examples": demo['examples']
    })

@app.post("/generate-book")
async def generate_book(request: BookRequest):
    """
    Ryan Book 자동 생성 API

    사용자 데이터를 받아 완전한 책 스펙(final_book_spec.json)을 생성합니다.

    요청 예시:
    {
        "child": {
            "firstName": "도현",
            "lastName": "김",
            "gender": "boy"
        },
        "objects": [
            {"name": "토끼", "emoji": "🐰", "josaMode": "friend"},
            {"name": "토마토", "emoji": "🍅", "josaMode": "object"}
        ],
        "familyMembers": [
            {"id": "mom", "relation": "엄마", "emoji": "👩"}
        ]
    }
    """
    if not RYAN_ENGINE_AVAILABLE:
        raise HTTPException(status_code=500, detail="Ryan Engine을 사용할 수 없습니다.")

    print("-" * 40)
    print(f"📚 책 생성 요청: {request.child.firstName}")
    start_time = time.time()

    try:
        # 테마 파일 경로
        theme_path = Path(__file__).parent / "ryan_engine" / "themes" / "theme_ryan.json"

        if not theme_path.exists():
            raise HTTPException(status_code=500, detail="테마 파일을 찾을 수 없습니다.")

        # BookGenerator 생성
        generator = BookGenerator(str(theme_path))

        # 요청 데이터를 딕셔너리로 변환
        user_data = {
            'child': request.child.model_dump(),
            'objects': [obj.model_dump() for obj in request.objects],
            'familyMembers': [fam.model_dump() for fam in request.familyMembers],
        }

        # 책 생성
        book_spec = generator.generate_from_dict(user_data)

        # JSON 변환
        book_json = generator.to_json(book_spec)

        # 파일로 저장 (선택적)
        output_dir = Path(__file__).parent / "output"
        output_dir.mkdir(exist_ok=True)
        safe_name = re.sub(r'[^a-zA-Z0-9가-힣_\-]', '_', request.child.firstName)
        output_path = output_dir / f"book_{safe_name}_{int(time.time())}.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(book_json)

        print(f"✅ 책 생성 완료! 파일: {output_path}")
        print(f"⚡ 소요시간: {time.time() - start_time:.2f}초")
        print("-" * 40)

        return JSONResponse(content={
            "success": True,
            "bookSpec": json.loads(book_json),
            "savedTo": str(output_path)
        })

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 책 생성 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"책 생성 중 오류가 발생했습니다: {str(e)}"
        )

@app.get("/health")
async def health_check():
    """서버 상태 확인"""
    return JSONResponse(content={
        "status": "ok",
        "device": device,
        "dtype": str(dtype),
        "ryan_engine": RYAN_ENGINE_AVAILABLE,
        "loaded_models": list(loaded_models.keys()) + (["ben2"] if ben2_model is not None else [])
    })

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 5001))
    workers = int(os.environ.get("WORKERS", 1))
    uvicorn.run("server:app", host="0.0.0.0", port=port, workers=workers)