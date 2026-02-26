# server.py (최적화 버전: FP16 + Warmup + 보안 강화)
import sys
import os

# === 로그 파일 설정 (stdout/stderr → 파일에 기록) ===
LOG_PATH = os.environ.get("SERVER_LOG", r"C:\Users\taeho\server.log")

class _LogWriter:
    """stdout/stderr를 파일에 기록. 콘솔이 있으면 콘솔에도 출력."""
    def __init__(self, log_file, original=None):
        self.log_file = log_file
        self.original = original
        self._has_console = False
        if original is not None:
            try:
                original.write("")
                self._has_console = True
            except Exception:
                pass
    def write(self, data):
        if not data:
            return
        self.log_file.write(data)
        self.log_file.flush()
        if self._has_console:
            try:
                self.original.write(data)
                self.original.flush()
            except Exception:
                self._has_console = False
    def flush(self):
        self.log_file.flush()
        if self._has_console:
            try:
                self.original.flush()
            except Exception:
                pass
    def isatty(self):
        return False

try:
    _log_file = open(LOG_PATH, "a", encoding="utf-8", buffering=1)
    sys.stdout = _LogWriter(_log_file, sys.__stdout__)
    sys.stderr = _LogWriter(_log_file, sys.__stderr__)
    print(f"\n{'='*60}")
    from datetime import datetime
    print(f"📋 서버 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📋 로그 파일: {LOG_PATH}")
    print(f"{'='*60}")
except Exception as e:
    # 로그 파일 열기 실패 시에도 서버는 정상 동작해야 함
    try:
        sys.__stderr__.write(f"⚠️ 로그 파일 열기 실패: {e}\n")
    except Exception:
        pass

from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Form, Body
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoModelForImageSegmentation
from torchvision import transforms
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Literal
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
register_heif_opener()
import torch
import gc
import io
import time
import asyncio
import threading
import numpy as np
import os
import json
import re
import traceback
import httpx
import base64
from pathlib import Path

# Ryan Engine 임포트
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

# SAM2 임포트
try:
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
    SAM2_AVAILABLE = True
    print("✅ SAM2 모듈 로드 완료")
except ImportError as e:
    SAM2_AVAILABLE = False
    print(f"⚠️ SAM2 모듈 없음: {e}")

# Grounding DINO 임포트
try:
    from transformers import AutoProcessor as GDinoProcessor, AutoModelForZeroShotObjectDetection
    GDINO_AVAILABLE = True
    print("✅ Grounding DINO 모듈 로드 완료")
except ImportError as e:
    GDINO_AVAILABLE = False
    print(f"⚠️ Grounding DINO 모듈 없음: {e}")

# Florence-2 임포트
try:
    from transformers import AutoModelForCausalLM as Florence2Model, AutoProcessor as Florence2Processor
    FLORENCE2_AVAILABLE = True
    print("✅ Florence-2 모듈 로드 완료")
except ImportError as e:
    FLORENCE2_AVAILABLE = False
    print(f"⚠️ Florence-2 모듈 없음: {e}")

# flash_attn 미설치 대응 패치 (Windows 등)
# 패치 전에 원본 함수 참조를 캡처 (mock.patch 후 재임포트 시 자기 자신 참조 방지)
try:
    from transformers.dynamic_module_utils import get_imports as _original_get_imports
except ImportError:
    _original_get_imports = None

def _fixed_get_imports(filename):
    """flash_attn 임포트를 제거하는 패치 — transformers.dynamic_module_utils.get_imports 대체"""
    if _original_get_imports is None:
        return []
    imports = _original_get_imports(filename)
    if "flash_attn" in imports:
        imports.remove("flash_attn")
    return imports

# ViTMatte 임포트
try:
    from transformers import VitMatteForImageMatting, VitMatteImageProcessor
    VITMATTE_AVAILABLE = True
    print("✅ ViTMatte 모듈 로드 완료")
except ImportError as e:
    VITMATTE_AVAILABLE = False
    print(f"⚠️ ViTMatte 모듈 없음: {e}")

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

from starlette.requests import Request as StarletteRequest
from starlette.middleware.base import BaseHTTPMiddleware

app = FastAPI()

class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        client = request.client.host if request.client else "unknown"
        path = request.url.path
        qs = str(request.url.query)
        cl = request.headers.get("content-length", "?")
        print(f"🔵 [{client}] {request.method} {path}{'?' + qs if qs else ''} (body: {cl} bytes)")
        try:
            response = await call_next(request)
            print(f"🟢 [{client}] {request.method} {path} → {response.status_code}")
            return response
        except Exception as e:
            print(f"🔴 [{client}] {request.method} {path} → ERROR: {e}")
            raise

app.add_middleware(RequestLogMiddleware)

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
    expose_headers=["X-Original-Width", "X-Original-Height", "X-Crop-X", "X-Crop-Y", "X-Crop-Width", "X-Crop-Height", "X-BGQA-Score", "X-BGQA-Passed", "X-BGQA-Issues", "X-BGQA-CaseType", "X-SAM2-Score", "X-Mask-Width", "X-Mask-Height"],  # 클라이언트에서 읽을 수 있는 커스텀 헤더
)

# 파일 검증 상수
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
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

# SAM2 모델 (Lazy Loading)
sam2_predictor = None
sam2_lock = threading.Lock()  # set_image → predict 원자성 보장

def get_sam2_predictor():
    """SAM2 모델 로드 (Lazy Loading)"""
    global sam2_predictor
    if sam2_predictor is not None:
        return sam2_predictor
    if not SAM2_AVAILABLE:
        raise ValueError("SAM2 모듈이 설치되지 않았습니다. pip install sam2")
    print("📂 SAM2 모델 로딩 중 (sam2.1-hiera-large)...")
    sam2_predictor = SAM2ImagePredictor.from_pretrained("facebook/sam2.1-hiera-large", device=device)
    print(f"✅ SAM2 모델 로드 완료 (device: {device})")
    return sam2_predictor

# SAM2 AutomaticMaskGenerator (Lazy Loading — predictor.model 공유)
sam2_mask_generator = None

def get_sam2_mask_generator():
    """SAM2 AutomaticMaskGenerator 로드 (기존 predictor의 model 공유)"""
    global sam2_mask_generator
    if sam2_mask_generator is not None:
        return sam2_mask_generator
    predictor = get_sam2_predictor()  # 모델 공유
    print("📂 SAM2 AutomaticMaskGenerator 초기화 중...")
    sam2_mask_generator = SAM2AutomaticMaskGenerator.from_pretrained(
        "facebook/sam2.1-hiera-large",
        points_per_side=32,
        pred_iou_thresh=0.7,
        stability_score_thresh=0.85,
        min_mask_region_area=100,
    )
    print("✅ SAM2 AutomaticMaskGenerator 준비 완료")
    return sam2_mask_generator

# Grounding DINO 모델 (Lazy Loading)
gdino_model = None
gdino_processor = None

def get_gdino_model():
    """Grounding DINO 모델 로드 (Lazy Loading)"""
    global gdino_model, gdino_processor
    if gdino_model is not None:
        return gdino_model, gdino_processor
    if not GDINO_AVAILABLE:
        raise ValueError("Grounding DINO가 설치되지 않았습니다.")
    print("📂 Grounding DINO 모델 로딩 중 (grounding-dino-tiny)...")
    gdino_processor = GDinoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
    gdino_model = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny")
    gdino_model.to(device)
    gdino_model.eval()
    print(f"✅ Grounding DINO 모델 로드 완료 (device: {device})")
    return gdino_model, gdino_processor

# MM-DINO 모델 (Lazy Loading)
mmdino_model = None
mmdino_processor = None

def get_mmdino_model():
    """MM-DINO 모델 로드 (Lazy Loading) — 50.6 AP, Swin-Tiny 백본"""
    global mmdino_model, mmdino_processor
    if mmdino_model is not None:
        return mmdino_model, mmdino_processor
    if not GDINO_AVAILABLE:
        raise ValueError("Grounding DINO가 설치되지 않았습니다.")
    print("📂 MM-DINO 모델 로딩 중 (mm_grounding_dino_tiny)...")
    mmdino_processor = GDinoProcessor.from_pretrained("openmmlab-community/mm_grounding_dino_tiny_o365v1_goldg_v3det")
    mmdino_model = AutoModelForZeroShotObjectDetection.from_pretrained("openmmlab-community/mm_grounding_dino_tiny_o365v1_goldg_v3det")
    mmdino_model.to(device)
    mmdino_model.eval()
    print(f"✅ MM-DINO 모델 로드 완료 (device: {device})")
    return mmdino_model, mmdino_processor

# Grounding DINO Base 모델 (Lazy Loading)
gdino_base_model = None
gdino_base_processor = None

def get_gdino_base_model():
    """Grounding DINO Base 모델 로드 (Lazy Loading) — 52.5 AP, Swin-Base 백본"""
    global gdino_base_model, gdino_base_processor
    if gdino_base_model is not None:
        return gdino_base_model, gdino_base_processor
    if not GDINO_AVAILABLE:
        raise ValueError("Grounding DINO가 설치되지 않았습니다.")
    print("📂 Grounding DINO Base 모델 로딩 중 (grounding-dino-base)...")
    gdino_base_processor = GDinoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    gdino_base_model = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-base")
    gdino_base_model.to(device)
    gdino_base_model.eval()
    print(f"✅ Grounding DINO Base 모델 로드 완료 (device: {device})")
    return gdino_base_model, gdino_base_processor

# Florence-2 모델 (Lazy Loading)
florence2_model = None
florence2_processor = None

def get_florence2_model():
    """Florence-2-large-ft 모델 로드 (Lazy Loading) — FP16, SDPA attention"""
    global florence2_model, florence2_processor
    if florence2_model is not None:
        return florence2_model, florence2_processor
    if not FLORENCE2_AVAILABLE:
        raise ValueError("Florence-2가 설치되지 않았습니다.")
    print("📂 Florence-2-large-ft 모델 로딩 중...")
    import unittest.mock
    # flash_attn 미설치 환경 대응: get_imports 패치
    with unittest.mock.patch("transformers.dynamic_module_utils.get_imports", _fixed_get_imports):
        florence2_model = Florence2Model.from_pretrained(
            "microsoft/Florence-2-large-ft",
            torch_dtype=torch.float16,
            attn_implementation="sdpa",
            trust_remote_code=True,
        )
    florence2_model.to(device)
    florence2_model.eval()
    florence2_processor = Florence2Processor.from_pretrained(
        "microsoft/Florence-2-large-ft",
        trust_remote_code=True,
    )
    print(f"✅ Florence-2-large-ft 모델 로드 완료 (device: {device})")
    return florence2_model, florence2_processor

# ViTMatte 모델 (Lazy Loading)
vitmatte_model = None
vitmatte_processor = None

def get_vitmatte_model():
    """ViTMatte 모델 로드 (Lazy Loading)"""
    global vitmatte_model, vitmatte_processor
    if vitmatte_model is not None:
        return vitmatte_model, vitmatte_processor
    if not VITMATTE_AVAILABLE:
        raise ValueError("ViTMatte가 설치되지 않았습니다.")
    print("📂 ViTMatte 모델 로딩 중 (vitmatte-small)...")
    vitmatte_processor = VitMatteImageProcessor.from_pretrained("hustvl/vitmatte-small-composition-1k")
    vitmatte_model = VitMatteForImageMatting.from_pretrained("hustvl/vitmatte-small-composition-1k")
    vitmatte_model.to(device)
    vitmatte_model.half()
    vitmatte_model.eval()
    print(f"✅ ViTMatte 모델 로드 완료 (device: {device})")
    return vitmatte_model, vitmatte_processor

# remove.bg API 설정
REMOVEBG_API_KEY = os.environ.get("REMOVEBG_API_KEY", "D8B2GQyMvmfbXXfH2mZukPi4")
REMOVEBG_ENABLED = os.environ.get("REMOVEBG_ENABLED", "true").lower() == "true"

# 2. 모델 설정 (Lazy Loading)
# 지원되는 BiRefNet 모델들 (모두 로컬)
BIREFNET_MODELS = {
    "portrait": "./models/birefnet-portrait",
    "hr": "./models/birefnet-hr",
    "hr-matting": "./models/birefnet-hr-matting",
    "dynamic": "./models/birefnet-dynamic",
    "rmbg2": "./models/rmbg2",
    # Alpha matting 모델 (soft alpha, 머리카락 한 올까지 처리)
    "matting": "./models/birefnet-matting",
    "hr-matting-alpha": "./models/birefnet-hr-matting-alpha",
    "dynamic-matting": "./models/birefnet-dynamic-matting",
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

async def call_removebg_api(image_data: bytes, size: str = "preview") -> Image.Image:
    """remove.bg API 호출하여 배경 제거된 RGBA 이미지 반환"""
    if not REMOVEBG_API_KEY:
        raise ValueError("REMOVEBG_API_KEY가 설정되지 않았습니다.")
    if size not in ("preview", "full"):
        size = "preview"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.remove.bg/v1.0/removebg",
            headers={"X-Api-Key": REMOVEBG_API_KEY},
            files={"image_file": ("image.jpg", image_data, "image/jpeg")},
            data={"size": size, "format": "png", "channels": "rgba"},
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
    model: str = Query(default="portrait", pattern="^(portrait|hr|hr-matting|dynamic|rmbg2|ben2|removebg|matting|hr-matting-alpha|dynamic-matting)$", description="배경 제거 모델"),
    removebg_size: str = Query(default="preview", pattern="^(preview|full)$", description="remove.bg 크기: preview(저해상도) 또는 full(원본)"),
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

    # 3. 이미지 유효성 검증 (to_thread로 이벤트 루프 블로킹 방지)
    def _load_image(data):
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        return img.convert("RGB")
    try:
        image = await asyncio.to_thread(_load_image, image_data)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail="손상된 이미지 파일이거나 올바른 이미지 형식이 아닙니다."
        )

    try:
        # 원본 크기 저장 (크롭 정보 헤더용)
        original_w, original_h = image.size

        if model == "removebg":
            if not REMOVEBG_ENABLED:
                raise HTTPException(status_code=403, detail="removebg API가 비활성화되어 있습니다. REMOVEBG_ENABLED=true로 설정하세요.")
            # remove.bg API 호출 — HEIC 등 비표준 포맷은 JPEG로 변환하여 전송
            buf = io.BytesIO()
            image.save(buf, format="JPEG", quality=95)
            jpeg_data = buf.getvalue()
            result_rgba = await call_removebg_api(jpeg_data, size=removebg_size)
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
# 각 모델은 자체 processor가 필요 (plus 모델은 config이 다름)
_vitpose_cache = {}  # model_type -> (model, processor)

VITPOSE_MODELS = {
    "vitpose": "usyd-community/vitpose-plus-base",       # 86M, 77.0 AP
    "vitpose-huge": "usyd-community/vitpose-plus-huge",   # 657M, 81.1 AP
}

def load_vitpose_model(model_type="vitpose"):
    """ViTPose 모델 로드 (처음 요청 시에만)"""
    global _vitpose_cache

    if model_type in _vitpose_cache:
        return _vitpose_cache[model_type]

    try:
        from transformers import AutoProcessor, VitPoseForPoseEstimation

        model_name = VITPOSE_MODELS.get(model_type)
        if not model_name:
            raise ValueError(f"알 수 없는 ViTPose 모델: {model_type}")

        print(f"📂 ViTPose 모델 로딩 중... ({model_name})")
        processor = AutoProcessor.from_pretrained(model_name)
        model = VitPoseForPoseEstimation.from_pretrained(model_name)
        model.to(device)
        model.eval()
        print(f"✅ ViTPose 모델 로드 완료 ({model_type})")

        _vitpose_cache[model_type] = (model, processor)
        return model, processor

    except ImportError as e:
        print(f"❌ Import 오류: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"ViTPose 모델을 사용하려면 transformers>=4.49.0이 필요합니다. 오류: {str(e)}"
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
        if 'dataset_index' not in inputs:
            inputs['dataset_index'] = torch.zeros(inputs['pixel_values'].shape[0], dtype=torch.long, device=device)

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
    model: str = Query(default="vitpose", pattern="^(vitpose|vitpose-huge)$", description="모델 선택"),
    boxes: str = Query(default="", description="DINO bboxes JSON: [[x1,y1,x2,y2], ...] (xyxy format)")
):
    """ViTPose를 사용한 포즈 감지 (멀티 person 지원)"""
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
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    # boxes 파라미터 파싱
    use_multi_person = False
    person_boxes = []
    if boxes:
        try:
            parsed_boxes = json.loads(boxes)
            if isinstance(parsed_boxes, list) and len(parsed_boxes) > 0:
                for b in parsed_boxes:
                    if len(b) == 4:
                        person_boxes.append([float(b[0]), float(b[1]), float(b[2]), float(b[3])])
                if person_boxes:
                    use_multi_person = True
                    print(f"   📦 {len(person_boxes)}개 person bbox 수신")
        except (json.JSONDecodeError, TypeError) as e:
            print(f"   ⚠️ boxes 파싱 실패: {e}, 전체 이미지 모드로 fallback")

    try:
        # 모델 로드 (Lazy)
        pose_model, processor = load_vitpose_model(model)

        if use_multi_person:
            # ===== 멀티 person 모드 (DINO boxes → per-person keypoints) =====
            # boxes: [batch, num_persons, 4] format for processor
            boxes_for_processor = [person_boxes]  # batch of 1
            inputs = processor(images=image, boxes=boxes_for_processor, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            # vitpose-plus 모델은 dataset_index 필요 (COCO = 0)
            if 'dataset_index' not in inputs:
                inputs['dataset_index'] = torch.zeros(inputs['pixel_values'].shape[0], dtype=torch.long, device=device)

            with torch.no_grad():
                outputs = pose_model(**inputs)

            # post_process returns list[list[dict]] — [batch][person]
            all_results = processor.post_process_pose_estimation(outputs, boxes=boxes_for_processor)[0]

            persons = []
            for idx, res in enumerate(all_results):
                kps = res['keypoints'].cpu().numpy()
                scs = res['scores'].cpu().numpy()
                persons.append({
                    "keypoints": [[float(kps[i][0]), float(kps[i][1])] for i in range(len(kps))],
                    "scores": [float(scs[i]) for i in range(len(scs))],
                    "bbox": person_boxes[idx],
                })
                valid_count = int((scs > 0.3).sum())
                print(f"   Person {idx}: {valid_count}/17 valid keypoints (bbox: [{person_boxes[idx][0]:.0f},{person_boxes[idx][1]:.0f},{person_boxes[idx][2]:.0f},{person_boxes[idx][3]:.0f}])")

            print(f"⚡ 완료! {len(persons)}명 포즈 감지, 소요시간: {time.time() - start_time:.2f}초")
            print("-" * 40)

            clear_gpu_memory()
            return JSONResponse(content={
                "success": True,
                "model": model,
                "persons": persons,
                "image_width": image.width,
                "image_height": image.height,
            })

        else:
            # ===== 단일 person 모드 (기존 호환) =====
            boxes_single = [[[0, 0, image.width, image.height]]]
            inputs = processor(images=image, boxes=boxes_single, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            if 'dataset_index' not in inputs:
                inputs['dataset_index'] = torch.zeros(inputs['pixel_values'].shape[0], dtype=torch.long, device=device)

            with torch.no_grad():
                outputs = pose_model(**inputs)

            results = processor.post_process_pose_estimation(outputs, boxes=boxes_single)[0][0]
            keypoints_xy = results['keypoints'].cpu().numpy()
            scores = results['scores'].cpu().numpy()

            print(f"🦴 감지된 키포인트: {len(keypoints_xy)}개")

            # BlazePose 형식으로 변환 (33개 키포인트, 없는 건 0으로)
            blazepose_keypoints = []
            for i in range(33):
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
                    blazepose_keypoints.append({
                        "x": 0, "y": 0, "score": 0, "name": f"keypoint_{i}"
                    })

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
        if 'dataset_index' not in inputs:
            inputs['dataset_index'] = torch.zeros(inputs['pixel_values'].shape[0], dtype=torch.long, device=device)

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

# ========== 인쇄 요청 API ==========

class PrintRequest(BaseModel):
    firstName: str
    parentNames: str = ""
    version: str = "A"
    bookId: str = ""
    timestamp: str = ""

@app.post("/request-print")
async def request_print(request: PrintRequest):
    """인쇄 요청 접수 (북토리 연동은 추후)"""
    print("-" * 40)
    print(f"🖨️ 인쇄 요청 접수: {request.firstName} (버전: {request.version}, bookId: {request.bookId})")
    print(f"   시각: {request.timestamp}")
    print("-" * 40)

    return JSONResponse(content={
        "success": True,
        "message": "인쇄 요청이 접수되었습니다.",
        "bookId": request.bookId,
    })

# ========== SAM2 아이 세그멘테이션 API ==========

@app.post("/segment-child")
async def segment_child(
    file: UploadFile = File(...),
    point_x: float = Form(default=0, description="아이 얼굴 중심 X 좌표"),
    point_y: float = Form(default=0, description="아이 얼굴 중심 Y 좌표"),
    neg_points: str = Form(default="", description="어른 얼굴 중심 좌표 JSON: [[x1,y1],[x2,y2],...]"),
    pos_points: str = Form(default="", description="ViTPose 아이 keypoints JSON: [[x1,y1],[x2,y2],...] (positive prompts)"),
    box: str = Form(default="", description="Box prompt JSON: [x1,y1,x2,y2] (Grounding DINO bbox)"),
    combine: bool = Form(default=False, description="True이면 box와 point를 동시에 사용 (가려진 신체 복원에 효과적)"),
):
    """
    SAM2 기반 아이 세그멘테이션

    face-api.js에서 감지한 아이 얼굴 중심 좌표를 point prompt로 사용하여
    SAM2가 아이만 세그먼트합니다. 어른 얼굴 좌표는 negative prompt로 사용.
    pos_points가 제공되면 ViTPose keypoints를 multi-point positive prompt로 사용.

    Returns: 아이만 추출된 투명 배경 WebP 이미지
    """
    print("-" * 40)
    print(f"👶 SAM2 아이 세그멘테이션 요청: {file.filename}")
    print(f"   아이 좌표: ({point_x:.0f}, {point_y:.0f})")
    start_time = time.time()

    if not SAM2_AVAILABLE:
        raise HTTPException(status_code=500, detail="SAM2 모듈이 설치되지 않았습니다.")

    # 파일 검증
    if not is_allowed_image(file):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다.")

    image_data = await file.read()
    if len(image_data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일이 너무 큽니다.")

    try:
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    try:
        predictor = get_sam2_predictor()

        # Box prompt + Point prompt 구성
        box_coords = None
        if box:
            try:
                box_list = json.loads(box)
                if len(box_list) == 4:
                    box_coords = np.array([box_list], dtype=np.float32)
                    print(f"   📦 Box prompt: [{box_list[0]:.0f}, {box_list[1]:.0f}, {box_list[2]:.0f}, {box_list[3]:.0f}]")
            except (json.JSONDecodeError, TypeError):
                print(f"   ⚠️ box 파싱 실패")

        # Point prompts 구성 (combine=True이면 box와 함께 사용)
        points = []
        labels = []

        if combine or not box_coords:
            # pos_points: ViTPose multi-point positive prompts
            if pos_points:
                try:
                    pos_list = json.loads(pos_points)
                    for pp in pos_list:
                        if len(pp) == 2:
                            points.append([float(pp[0]), float(pp[1])])
                            labels.append(1)  # foreground
                    print(f"   ViTPose positive points: {len(pos_list)}개")
                except (json.JSONDecodeError, TypeError):
                    print(f"   ⚠️ pos_points 파싱 실패, point_x/y fallback")

            # pos_points가 없거나 파싱 실패 시 기존 point_x/point_y 사용
            if not points:
                points.append([point_x, point_y])
                labels.append(1)  # foreground (아이)

            # negative points 파싱 (어른 얼굴/keypoints 좌표)
            if neg_points:
                try:
                    neg_list = json.loads(neg_points)
                    for np_coord in neg_list:
                        if len(np_coord) == 2:
                            points.append([float(np_coord[0]), float(np_coord[1])])
                            labels.append(0)  # background (어른)
                    print(f"   Negative points: {len(neg_list)}개")
                except (json.JSONDecodeError, TypeError):
                    print(f"   ⚠️ neg_points 파싱 실패, 무시")

            print(f"   총 points: {len(points)}개 (pos={sum(1 for l in labels if l==1)}, neg={sum(1 for l in labels if l==0)})")

        point_coords_arr = np.array(points, dtype=np.float32) if points else None
        point_labels_arr = np.array(labels, dtype=np.int32) if labels else None

        if combine and box_coords is not None and point_coords_arr is not None:
            print(f"   🔗 Combine 모드: box + {len(points)}개 point 동시 사용")

        # SAM2 추론 (GPU 작업이므로 to_thread 사용)
        def _run_sam2():
            img_np = np.array(image)
            with sam2_lock, torch.inference_mode():
                predictor.set_image(img_np)
                masks, scores, logits = predictor.predict(
                    point_coords=point_coords_arr,
                    point_labels=point_labels_arr,
                    box=box_coords,
                    multimask_output=True,
                )
            # 가장 높은 점수의 마스크 선택
            best_idx = np.argmax(scores)
            best_mask = masks[best_idx]
            best_score = float(scores[best_idx])
            parts = []
            if box_coords is not None: parts.append("box")
            if point_coords_arr is not None: parts.append(f"point×{len(points)}")
            prompt_type = "+".join(parts) if parts else "none"
            print(f"   SAM2 마스크 {len(masks)}개 생성 ({prompt_type}), 최고 점수: {best_score:.3f} (idx={best_idx})")
            return best_mask, best_score

        mask_np, mask_score = await asyncio.to_thread(_run_sam2)

        # 마스크를 PIL Image로 변환
        mask_uint8 = (mask_np * 255).astype(np.uint8)
        mask_pil = Image.fromarray(mask_uint8)

        # 원본 이미지에 마스크 적용
        result = image.copy()
        result.putalpha(mask_pil)

        # 알파 채널 기준 크롭
        alpha = result.split()[-1]
        alpha_clean = alpha.point(lambda x: 0 if x < 30 else x)
        bbox = alpha_clean.getbbox()

        original_w, original_h = image.size
        crop_x, crop_y = 0, 0

        if bbox:
            padding = 20
            x1, y1, x2, y2 = bbox
            crop_x = max(0, x1 - padding)
            crop_y = max(0, y1 - padding)
            x2 = min(result.width, x2 + padding)
            y2 = min(result.height, y2 + padding)
            result = result.crop((crop_x, crop_y, x2, y2))
            print(f"   ✂️ 크롭: ({crop_x},{crop_y}) → {result.size}")

        # WebP로 인코딩
        img_byte_arr = io.BytesIO()
        result.save(img_byte_arr, format='WEBP', quality=90)

        elapsed = time.time() - start_time
        print(f"⚡ SAM2 완료! 소요시간: {elapsed:.2f}초")
        print("-" * 40)

        headers = {
            "X-Original-Width": str(original_w),
            "X-Original-Height": str(original_h),
            "X-Crop-X": str(crop_x),
            "X-Crop-Y": str(crop_y),
            "X-Crop-Width": str(result.width),
            "X-Crop-Height": str(result.height),
            "X-SAM2-Score": f"{mask_score:.3f}",
        }

        clear_gpu_memory()
        return Response(content=img_byte_arr.getvalue(), media_type="image/webp", headers=headers)

    except Exception as e:
        clear_gpu_memory()
        print(f"❌ SAM2 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"SAM2 세그멘테이션 오류: {str(e)}")

# ========== SAM2 전체 오브젝트 세그멘테이션 API ==========

@app.post("/segment-all")
async def segment_all(
    file: UploadFile = File(...),
    max_masks: int = Query(default=30, ge=1, le=100, description="최대 마스크 수"),
    min_area_pct: float = Query(default=0.5, ge=0.0, le=50.0, description="최소 면적 비율 (%)"),
):
    """
    SAM2 AutomaticMaskGenerator로 이미지 내 모든 오브젝트 자동 세그멘테이션.
    label map (grayscale PNG, pixel=segment index, 0=background)과 메타데이터를 반환.
    """
    print("-" * 40)
    print(f"🎯 SAM2 전체 세그멘테이션 요청: {file.filename} (max_masks={max_masks}, min_area_pct={min_area_pct}%)")
    start_time = time.time()

    if not SAM2_AVAILABLE:
        raise HTTPException(status_code=500, detail="SAM2 모듈이 설치되지 않았습니다.")

    if not is_allowed_image(file):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다.")

    image_data = await file.read()
    if len(image_data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일이 너무 큽니다.")

    try:
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    try:
        orig_w, orig_h = image.size

        # 성능 최적화: max 1024px로 리사이즈 후 처리
        MAX_SIDE = 1024
        scale = 1.0
        if max(orig_w, orig_h) > MAX_SIDE:
            scale = MAX_SIDE / max(orig_w, orig_h)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            image_small = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
            print(f"   📐 리사이즈: {orig_w}x{orig_h} → {new_w}x{new_h}")
        else:
            image_small = image
            new_w, new_h = orig_w, orig_h

        generator = get_sam2_mask_generator()

        def _run_auto_mask():
            img_np = np.array(image_small)
            with sam2_lock, torch.inference_mode():
                masks = generator.generate(img_np)
            return masks

        raw_masks = await asyncio.to_thread(_run_auto_mask)
        print(f"   SAM2 자동 마스크 {len(raw_masks)}개 생성")

        # 면적 필터링 & 정렬 (면적 큰 순)
        total_area = new_w * new_h
        min_area = total_area * (min_area_pct / 100.0)
        filtered = [m for m in raw_masks if m['area'] >= min_area]
        filtered.sort(key=lambda m: m['area'], reverse=True)
        filtered = filtered[:max_masks]
        print(f"   필터링 후 {len(filtered)}개 (min_area={min_area:.0f}px)")

        # label map 구성 (작은 해상도 기준)
        label_map_small = np.zeros((new_h, new_w), dtype=np.uint8)
        segments = []
        for i, m in enumerate(filtered):
            idx = i + 1  # 1-based (0=background)
            mask = m['segmentation']  # bool array (new_h, new_w)
            label_map_small[mask] = idx

            # bbox를 원본 해상도로 변환
            bx, by, bw, bh = m['bbox']  # XYWH format
            if scale != 1.0:
                bx = int(bx / scale)
                by = int(by / scale)
                bw = int(bw / scale)
                bh = int(bh / scale)
            orig_area = int(m['area'] / (scale * scale))

            segments.append({
                "index": idx,
                "bbox": [bx, by, bx + bw, by + bh],
                "area": orig_area,
                "area_pct": round(orig_area / (orig_w * orig_h) * 100, 2),
                "score": round(float(m.get('predicted_iou', m.get('stability_score', 0))), 3),
            })

        # label map을 원본 크기로 복원 (NEAREST 보간으로 경계 유지)
        label_map_pil = Image.fromarray(label_map_small, mode='L')
        if scale != 1.0:
            label_map_pil = label_map_pil.resize((orig_w, orig_h), Image.Resampling.NEAREST)

        # PNG로 인코딩 → base64
        buf = io.BytesIO()
        label_map_pil.save(buf, format='PNG')
        label_map_b64 = base64.b64encode(buf.getvalue()).decode('ascii')

        elapsed = time.time() - start_time
        print(f"⚡ SAM2 전체 세그멘테이션 완료! {len(segments)}개 세그먼트, {elapsed:.2f}초")
        print("-" * 40)

        clear_gpu_memory()
        return JSONResponse(content={
            "segments": segments,
            "label_map": label_map_b64,
            "image_width": orig_w,
            "image_height": orig_h,
        })

    except Exception as e:
        clear_gpu_memory()
        print(f"❌ SAM2 전체 세그멘테이션 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"SAM2 전체 세그멘테이션 오류: {str(e)}")

# ========== 아이 감지 API (DINO / MM-DINO / DINO-Base / Florence-2) ==========
# ⚠️ VRAM 참고: 4개 모델 전부 로드 시 ~2.7GB. RTX 4070S(12GB)에서 다른 모델과 합산 시 주의.

def _build_detections(boxes_list, scores_list, labels_list):
    """감지 결과를 통일된 형식으로 변환"""
    detections = []
    for i, (box, score) in enumerate(zip(boxes_list, scores_list)):
        x1, y1, x2, y2 = box
        w = x2 - x1
        h = y2 - y1
        detections.append({
            "box": [float(x1), float(y1), float(x2), float(y2)],
            "score": float(score),
            "label": labels_list[i] if i < len(labels_list) else "unknown",
            "width": float(w),
            "height": float(h),
            "area": float(w * h),
            "cx": float(x1 + w / 2),
            "cy": float(y1 + h / 2),
        })
    detections.sort(key=lambda d: d["area"], reverse=True)
    return detections

@app.post("/detect-child")
async def detect_child(
    file: UploadFile = File(...),
    prompt: str = Query(default="child . person", description="감지할 텍스트 프롬프트 (마침표로 구분)"),
    threshold: float = Query(default=0.25, ge=0.05, le=0.9, description="감지 임계값"),
    model: Literal["gdino", "mmdino", "gdino-base", "florence2"] = Query(default="gdino", description="감지 모델"),
    task: Literal["od", "grounding"] = Query(default="od", description="Florence-2 태스크"),
):
    """
    이미지에서 아이/인물 감지 (다중 모델 지원)
    - gdino: Grounding DINO Tiny (기본, 48.4 AP)
    - mmdino: MM-DINO Tiny (50.6 AP)
    - gdino-base: Grounding DINO Base (52.5 AP)
    - florence2: Florence-2-large-ft (멀티태스크)
    """
    MODEL_LABELS = {"gdino": "DINO-Tiny", "mmdino": "MM-DINO", "gdino-base": "DINO-Base", "florence2": "Florence-2"}
    model_label = MODEL_LABELS.get(model, model)

    print("-" * 40)
    if model == "florence2":
        print(f"🔍 {model_label} 감지 요청: {file.filename} (model: {model}, task: {task}, prompt: '{prompt}')")
    else:
        print(f"🔍 {model_label} 감지 요청: {file.filename} (model: {model}, prompt: '{prompt}', threshold: {threshold})")
    start_time = time.time()

    if model in ("gdino", "mmdino", "gdino-base") and not GDINO_AVAILABLE:
        raise HTTPException(status_code=500, detail="Grounding DINO가 설치되지 않았습니다.")
    if model == "florence2" and not FLORENCE2_AVAILABLE:
        raise HTTPException(status_code=500, detail="Florence-2가 설치되지 않았습니다.")

    if not is_allowed_image(file):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다.")

    image_data = await file.read()
    if len(image_data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일이 너무 큽니다.")

    try:
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    try:
        # ---- DINO-like 모델 (gdino, mmdino, gdino-base) ----
        if model in ("gdino", "mmdino", "gdino-base"):
            if model == "mmdino":
                m, proc = get_mmdino_model()
            elif model == "gdino-base":
                m, proc = get_gdino_base_model()
            else:
                m, proc = get_gdino_model()

            def _run_dino_like():
                gdino_prompt = prompt.strip()
                if not gdino_prompt.endswith('.'):
                    gdino_prompt += '.'
                inputs = proc(images=image, text=gdino_prompt, return_tensors="pt").to(device)
                with torch.no_grad():
                    outputs = m(**inputs)
                results = proc.post_process_grounded_object_detection(
                    outputs,
                    inputs.input_ids,
                    threshold=threshold,
                    text_threshold=threshold,
                    target_sizes=[image.size[::-1]],
                )[0]
                return results

            results = await asyncio.to_thread(_run_dino_like)
            boxes = results["boxes"].cpu().numpy().tolist()
            scores = results["scores"].cpu().numpy().tolist()
            labels = results["labels"]
            detections = _build_detections(boxes, scores, labels)

        # ---- Florence-2 ----
        elif model == "florence2":
            f2_model, f2_proc = get_florence2_model()

            def _run_florence2():
                if task == "grounding":
                    task_prompt = "<CAPTION_TO_PHRASE_GROUNDING>"
                    text_input = prompt.strip()
                else:
                    task_prompt = "<OD>"
                    text_input = task_prompt

                inputs = f2_proc(text=text_input, images=image, return_tensors="pt")
                inputs = {k: v.to(device) if hasattr(v, 'to') else v for k, v in inputs.items()}
                # FP16 변환
                if inputs.get("pixel_values") is not None:
                    inputs["pixel_values"] = inputs["pixel_values"].to(torch.float16)

                with torch.no_grad():
                    generated_ids = f2_model.generate(
                        input_ids=inputs["input_ids"],
                        pixel_values=inputs["pixel_values"],
                        max_new_tokens=1024,
                        num_beams=3,
                    )
                generated_text = f2_proc.batch_decode(generated_ids, skip_special_tokens=False)[0]
                parsed = f2_proc.post_process_generation(
                    generated_text,
                    task=task_prompt,
                    image_size=(image.width, image.height),
                )
                return parsed, task_prompt

            parsed, task_prompt = await asyncio.to_thread(_run_florence2)

            f2_boxes = []
            f2_labels = []

            if task == "grounding" and "<CAPTION_TO_PHRASE_GROUNDING>" in parsed:
                result = parsed["<CAPTION_TO_PHRASE_GROUNDING>"]
                raw_boxes = result.get("bboxes", [])
                raw_labels = result.get("labels", [])
                for bbox, lbl in zip(raw_boxes, raw_labels):
                    f2_boxes.append(bbox)
                    f2_labels.append(lbl)
            elif "<OD>" in parsed:
                result = parsed["<OD>"]
                raw_boxes = result.get("bboxes", [])
                raw_labels = result.get("labels", [])
                _PERSON_KEYWORDS = {"person", "child", "human", "man", "woman", "boy", "girl", "baby", "kid", "toddler", "infant"}
                for bbox, lbl in zip(raw_boxes, raw_labels):
                    # OD 모드: 인물 관련 라벨만 필터 (단어 단위 매칭)
                    lbl_words = set(lbl.lower().split())
                    if lbl_words & _PERSON_KEYWORDS:
                        f2_boxes.append(bbox)
                        f2_labels.append(lbl)

            # Florence-2는 confidence score 없음 → 1.0 고정
            f2_scores = [1.0] * len(f2_boxes)
            detections = _build_detections(f2_boxes, f2_scores, f2_labels)

        else:
            raise HTTPException(status_code=400, detail=f"지원하지 않는 모델: {model}. gdino|mmdino|gdino-base|florence2 중 선택")

        elapsed = time.time() - start_time
        print(f"   감지 결과: {len(detections)}개 ({model_label})")
        for d in detections:
            print(f"   - [{d['label']}] {d['score']:.2f} box=({d['box'][0]:.0f},{d['box'][1]:.0f},{d['box'][2]:.0f},{d['box'][3]:.0f})")
        print(f"⚡ 완료! 소요시간: {elapsed:.2f}초")
        print("-" * 40)

        clear_gpu_memory()
        return JSONResponse(content={
            "success": True,
            "detections": detections,
            "model": model,
            "image_width": image.width,
            "image_height": image.height,
        })

    except HTTPException:
        raise
    except Exception as e:
        clear_gpu_memory()
        print(f"❌ {model_label} 감지 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"{model_label} 감지 오류: {str(e)}")

# ========== ViTMatte 알파 매팅 API ==========

@app.post("/vitmatte")
async def run_vitmatte(
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
    erode_size: int = Query(default=10, ge=1, le=50, description="Trimap foreground erode 크기"),
    dilate_size: int = Query(default=20, ge=1, le=100, description="Trimap unknown 영역 dilate 크기"),
):
    """
    ViTMatte 알파 매팅

    SAM2 등의 rough mask를 trimap으로 변환하여 정밀 알파 매트 생성.
    머리카락 한 올 단위의 반투명 처리 가능.

    - file: 원본 이미지
    - mask: 바이너리 마스크 (흰색=전경, 검정=배경, 원본과 동일 크기)
    """
    print("-" * 40)
    print(f"🎨 ViTMatte 요청: {file.filename} (erode={erode_size}, dilate={dilate_size})")
    start_time = time.time()

    if not VITMATTE_AVAILABLE:
        raise HTTPException(status_code=500, detail="ViTMatte가 설치되지 않았습니다.")

    # 파일 읽기
    image_data = await file.read()
    mask_data = await mask.read()

    try:
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    try:
        mask_img = Image.open(io.BytesIO(mask_data)).convert("L")
        # 마스크를 원본 크기에 맞추기
        if mask_img.size != image.size:
            mask_img = mask_img.resize(image.size, Image.Resampling.LANCZOS)
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 마스크 형식이 아닙니다.")

    try:
        import cv2

        vit_model, vit_processor = get_vitmatte_model()

        mask_np = np.array(mask_img)

        # Trimap 생성: erode → definite FG, dilate → unknown boundary
        kernel_e = np.ones((erode_size, erode_size), np.uint8)
        kernel_d = np.ones((dilate_size, dilate_size), np.uint8)
        fg = cv2.erode(mask_np, kernel_e, iterations=1)
        dilated = cv2.dilate(mask_np, kernel_d, iterations=1)

        trimap = np.zeros_like(mask_np, dtype=np.uint8)
        trimap[fg > 128] = 255           # definite foreground
        trimap[(dilated > 128) & (fg <= 128)] = 128  # unknown
        # rest stays 0 = definite background

        trimap_pil = Image.fromarray(trimap)
        print(f"   Trimap 생성: FG={np.sum(trimap==255)}, Unknown={np.sum(trimap==128)}, BG={np.sum(trimap==0)}")

        # GPU VRAM 절약: 큰 이미지는 리사이즈 후 처리 → 알파맵만 원본 크기로 복원
        MAX_VITMATTE_DIM = 1024
        orig_w, orig_h = image.size
        if max(orig_w, orig_h) > MAX_VITMATTE_DIM:
            scale = MAX_VITMATTE_DIM / max(orig_w, orig_h)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            image_small = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
            trimap_small = trimap_pil.resize((new_w, new_h), Image.Resampling.NEAREST)
            print(f"   📐 ViTMatte 리사이즈: {orig_w}x{orig_h} → {new_w}x{new_h}")
        else:
            image_small = image
            trimap_small = trimap_pil

        def _run_vitmatte():
            inputs = vit_processor(images=image_small, trimaps=trimap_small, return_tensors="pt")
            inputs = {k: v.to(device).half() if v.dtype == torch.float32 else v.to(device) for k, v in inputs.items()}
            with torch.no_grad():
                output = vit_model(**inputs)
            alpha = output.alphas[0, 0].float().cpu().numpy()
            alpha = np.clip(alpha * 255, 0, 255).astype(np.uint8)
            return alpha

        alpha_np = await asyncio.to_thread(_run_vitmatte)
        alpha_pil = Image.fromarray(alpha_np)
        # 리사이즈했으면 알파맵을 원본 크기로 복원
        if alpha_pil.size != (orig_w, orig_h):
            alpha_pil = alpha_pil.resize((orig_w, orig_h), Image.Resampling.LANCZOS)
            print(f"   📐 알파맵 복원: {alpha_np.shape[1]}x{alpha_np.shape[0]} → {orig_w}x{orig_h}")

        # 원본에 알파 적용
        result = image.copy()
        result.putalpha(alpha_pil)

        # 크롭 (알파 기준)
        alpha_clean = alpha_pil.point(lambda x: 0 if x < 10 else x)
        bbox = alpha_clean.getbbox()
        crop_x, crop_y = 0, 0

        if bbox:
            padding = 20
            x1, y1, x2, y2 = bbox
            crop_x = max(0, x1 - padding)
            crop_y = max(0, y1 - padding)
            x2 = min(result.width, x2 + padding)
            y2 = min(result.height, y2 + padding)
            result = result.crop((crop_x, crop_y, x2, y2))
            print(f"   ✂️ 크롭: ({crop_x},{crop_y}) → {result.size}")

        # WebP 인코딩
        img_byte_arr = io.BytesIO()
        result.save(img_byte_arr, format='WEBP', quality=90)

        elapsed = time.time() - start_time
        print(f"⚡ ViTMatte 완료! 소요시간: {elapsed:.2f}초")
        print("-" * 40)

        headers = {
            "X-Original-Width": str(image.width),
            "X-Original-Height": str(image.height),
            "X-Crop-X": str(crop_x),
            "X-Crop-Y": str(crop_y),
            "X-Crop-Width": str(result.width),
            "X-Crop-Height": str(result.height),
        }

        clear_gpu_memory()
        return Response(content=img_byte_arr.getvalue(), media_type="image/webp", headers=headers)

    except Exception as e:
        clear_gpu_memory()
        print(f"❌ ViTMatte 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"ViTMatte 오류: {str(e)}")

# ========== MEMatte 알파 매팅 API ==========

mematte_model = None

def get_mematte_model():
    """MEMatte 모델 로드 (Lazy Loading)"""
    global mematte_model
    if mematte_model is not None:
        return mematte_model

    import sys
    mematte_dir = os.path.join(os.path.dirname(__file__), "models", "mematte")
    if mematte_dir not in sys.path:
        sys.path.insert(0, mematte_dir)

    from detectron2.config import LazyConfig, instantiate
    from detectron2.checkpoint import DetectionCheckpointer

    print("📂 MEMatte 모델 로딩 중...")
    cfg = LazyConfig.load(os.path.join(mematte_dir, "configs", "MEMatte_S_topk0.25_win_global_long.py"))
    cfg.model.teacher_backbone = None
    cfg.model.backbone.max_number_token = 18000
    model = instantiate(cfg.model)
    model.to(device)
    model.eval()
    ckpt_path = os.path.join(mematte_dir, "checkpoints", "MEMatte_ViTS_DIM.pth")
    DetectionCheckpointer(model).load(ckpt_path)
    print("✅ MEMatte 모델 로드 완료")
    mematte_model = model
    return mematte_model

@app.post("/mematte")
async def run_mematte(
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
    erode_size: int = Query(default=10, ge=1, le=50, description="Trimap foreground erode 크기"),
    dilate_size: int = Query(default=20, ge=1, le=100, description="Trimap unknown 영역 dilate 크기"),
):
    """
    MEMatte 알파 매팅 (ViTMatte 대비 메모리 88% 절약, 동일 품질)

    ViTMatte와 동일하게 rough mask를 trimap으로 변환하여 정밀 알파 매트 생성.
    """
    print("-" * 40)
    print(f"🧠 MEMatte 요청: {file.filename} (erode={erode_size}, dilate={dilate_size})")
    start_time = time.time()

    if not is_allowed_image(file):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다.")

    image_data = await file.read()
    mask_data = await mask.read()
    if len(image_data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일이 너무 큽니다.")

    try:
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")

        mask_img = Image.open(io.BytesIO(mask_data)).convert("L")

        orig_w, orig_h = image.size

        # Trimap 생성 (ViTMatte와 동일 로직)
        import cv2
        mask_np = np.array(mask_img)
        kernel_e = np.ones((erode_size, erode_size), np.uint8)
        kernel_d = np.ones((dilate_size, dilate_size), np.uint8)
        fg = cv2.erode(mask_np, kernel_e, iterations=1)
        dilated = cv2.dilate(mask_np, kernel_d, iterations=1)

        trimap = np.zeros_like(mask_np, dtype=np.uint8)
        trimap[fg > 128] = 255
        trimap[(dilated > 128) & (fg <= 128)] = 128

        trimap_pil = Image.fromarray(trimap)
        print(f"   Trimap 생성: FG={np.sum(trimap==255)}, Unknown={np.sum(trimap==128)}, BG={np.sum(trimap==0)}")

        model = get_mematte_model()

        from torchvision.transforms import functional as TF
        import torch

        # 입력 준비: image(3ch) + trimap(1ch) → 4ch tensor
        img_tensor = TF.to_tensor(image)  # [3, H, W]
        tri_tensor = TF.to_tensor(trimap_pil)[0:1, :, :]  # [1, H, W]

        data = {
            'image': img_tensor.unsqueeze(0).to(device),
            'trimap': tri_tensor.unsqueeze(0).to(device),
        }

        def _run_mematte():
            with torch.no_grad():
                output, _, _ = model(data, patch_decoder=True)
                alpha = output['phas'].flatten(0, 2)  # [H, W]
                # Trimap enforce
                tri_flat = tri_tensor.squeeze(0).squeeze(0)
                alpha[tri_flat == 0] = 0
                alpha[tri_flat == 1] = 1
                return alpha.cpu()

        alpha = await asyncio.to_thread(_run_mematte)

        alpha_np = (alpha.numpy() * 255).astype(np.uint8)
        alpha_pil = Image.fromarray(alpha_np).resize((orig_w, orig_h), Image.Resampling.LANCZOS)

        # RGBA 결과 생성
        result = image.copy()
        result.putalpha(alpha_pil)

        # 크롭 (불투명 영역만)
        bbox = result.getbbox()
        if bbox:
            result = result.crop(bbox)
            print(f"   ✂️ 크롭: ({bbox[0]},{bbox[1]}) 크기({bbox[2]-bbox[0]}, {bbox[3]-bbox[1]})")

        buf = io.BytesIO()
        result.save(buf, format="WEBP", quality=95)
        buf.seek(0)

        elapsed = time.time() - start_time
        print(f"✅ MEMatte 완료! 소요시간: {elapsed:.2f}초")

        return Response(content=buf.getvalue(), media_type="image/webp")

    except Exception as e:
        clear_gpu_memory()
        print(f"❌ MEMatte 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"MEMatte 오류: {str(e)}")

# ============================================================
# BiRefNet-HR-matting (trimap-free, 고해상도 매팅)
# ============================================================

_birefnet_matting_model = None

def get_birefnet_matting():
    global _birefnet_matting_model
    if _birefnet_matting_model is not None:
        return _birefnet_matting_model
    from transformers import AutoModelForImageSegmentation
    print("📦 BiRefNet-HR-matting 모델 로딩...")
    model = AutoModelForImageSegmentation.from_pretrained(
        "ZhengPeng7/BiRefNet_HR-matting", trust_remote_code=True
    )
    model.to(device, dtype=torch.float16)
    model.eval()
    _birefnet_matting_model = model
    print(f"✅ BiRefNet-HR-matting 로딩 완료 ({sum(p.numel() for p in model.parameters()) / 1e6:.1f}M, FP16)")
    return model


@app.post("/birefnet-matting")
async def run_birefnet_matting(
    file: UploadFile = File(...),
    resolution: int = Query(default=2048, ge=512, le=4096, description="처리 해상도 (긴 쪽 기준)"),
):
    """
    BiRefNet-HR-matting — trimap 없이 이미지만으로 고품질 알파 매팅.
    머리카락/반투명 경계를 정밀하게 처리.
    """
    print("-" * 40)
    print(f"🎨 BiRefNet-HR-matting 요청: {file.filename} (resolution={resolution})")
    start_time = time.time()

    image_data = await file.read()
    try:
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    try:
        from torchvision import transforms

        model = get_birefnet_matting()
        orig_w, orig_h = image.size

        # 해상도 조정
        scale = min(resolution / max(orig_w, orig_h), 1.0)
        proc_w = int(orig_w * scale)
        proc_h = int(orig_h * scale)
        # 32배수 정렬
        proc_w = (proc_w + 31) // 32 * 32
        proc_h = (proc_h + 31) // 32 * 32

        transform = transforms.Compose([
            transforms.Resize((proc_h, proc_w)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        input_tensor = transform(image).unsqueeze(0).to(device, dtype=torch.float16)

        with torch.no_grad():
            preds = model(input_tensor)[-1].sigmoid()

        alpha = preds[0, 0].cpu().float().numpy()
        alpha = (alpha * 255).astype(np.uint8)

        del input_tensor, preds
        torch.cuda.empty_cache()

        # 원본 크기로 복원
        alpha_img = Image.fromarray(alpha).resize((orig_w, orig_h), Image.Resampling.LANCZOS)

        # RGBA 합성
        result = image.copy()
        result.putalpha(alpha_img)

        elapsed = time.time() - start_time
        print(f"✅ BiRefNet-HR-matting 완료: {orig_w}x{orig_h} → {proc_w}x{proc_h} | {elapsed:.2f}초")

        buf = io.BytesIO()
        result.save(buf, format="WEBP", quality=95, lossless=False)
        buf.seek(0)
        return Response(content=buf.getvalue(), media_type="image/webp")

    except Exception as e:
        clear_gpu_memory()
        print(f"❌ BiRefNet-HR-matting 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"BiRefNet-HR-matting 오류: {str(e)}")


# ============================================================
# DiffMatte (diffusion 기반 매팅, trimap 필요)
# ============================================================

_diffmatte_model = None
DIFFMATTE_DIR = r"C:\Documents and Settings\connect\automation-prototype\DiffMatte"

def get_diffmatte():
    global _diffmatte_model
    if _diffmatte_model is not None:
        return _diffmatte_model

    import sys as _sys
    if DIFFMATTE_DIR not in _sys.path:
        _sys.path.insert(0, DIFFMATTE_DIR)

    from detectron2.config import LazyConfig, instantiate
    from detectron2.checkpoint import DetectionCheckpointer
    from re import findall

    config_path = os.path.join(DIFFMATTE_DIR, "configs", "ViTB.py")
    checkpoint_path = os.path.join(DIFFMATTE_DIR, "checkpoints", "DiffMatte-ViTB.pth")
    sample_strategy = "ddim10"

    print(f"📦 DiffMatte-ViTB 모델 로딩... ({checkpoint_path})")
    cfg = LazyConfig.load(config_path)

    cfg.difmatte.args["use_ddim"] = True if "ddim" in sample_strategy else False
    cfg.diffusion.steps = int(findall(r"\d+", sample_strategy)[0])

    model = instantiate(cfg.model)
    diffusion = instantiate(cfg.diffusion)
    cfg.difmatte.model = model
    cfg.difmatte.diffusion = diffusion
    difmatte = instantiate(cfg.difmatte)
    difmatte.to(device)
    difmatte.eval()
    DetectionCheckpointer(difmatte).load(checkpoint_path)

    _diffmatte_model = difmatte
    print(f"✅ DiffMatte-ViTB 로딩 완료 (FP32, max_size로 VRAM 관리)")
    return difmatte


@app.post("/diffmatte")
async def run_diffmatte(
    file: UploadFile = File(...),
    mask: UploadFile = File(...),
    erode_size: int = Query(default=10, ge=1, le=50),
    dilate_size: int = Query(default=20, ge=1, le=100),
    max_size: int = Query(default=1024, ge=256, le=2048, description="처리 해상도 (긴 쪽 기준). ViT 어텐션 특성상 큰 이미지는 OOM 위험"),
):
    """
    DiffMatte — Diffusion 기반 매팅 (ECCV 2024, Composition-1k SOTA급).
    trimap이 필요합니다 (mask에서 자동 생성).
    """
    print("-" * 40)
    print(f"🎨 DiffMatte 요청: {file.filename} (erode={erode_size}, dilate={dilate_size}, max_size={max_size})")
    start_time = time.time()

    image_data = await file.read()
    mask_data = await mask.read()

    try:
        image = Image.open(io.BytesIO(image_data))
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 이미지 형식이 아닙니다.")

    orig_size = image.size  # (W, H) — 출력은 원본 크기로 복원

    try:
        mask_img = Image.open(io.BytesIO(mask_data)).convert("L")
        if mask_img.size != image.size:
            mask_img = mask_img.resize(image.size, Image.Resampling.LANCZOS)
    except Exception:
        raise HTTPException(status_code=400, detail="올바른 마스크 형식이 아닙니다.")

    # 리사이즈 (ViT 어텐션 O(n²) 때문에 VRAM 절약 필수)
    w, h = image.size
    if max(w, h) > max_size:
        scale = max_size / max(w, h)
        new_w, new_h = int(w * scale), int(h * scale)
        image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
        mask_img = mask_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        print(f"   리사이즈: {w}x{h} → {new_w}x{new_h}")

    try:
        import cv2
        from torchvision.transforms import functional as TF

        model = get_diffmatte()

        # Trimap 생성
        mask_np = np.array(mask_img)
        kernel_e = np.ones((erode_size, erode_size), np.uint8)
        kernel_d = np.ones((dilate_size, dilate_size), np.uint8)
        fg = cv2.erode(mask_np, kernel_e, iterations=1)
        dilated = cv2.dilate(mask_np, kernel_d, iterations=1)

        trimap_np = np.zeros_like(mask_np, dtype=np.uint8)
        trimap_np[fg > 128] = 255
        trimap_np[(dilated > 128) & (fg <= 128)] = 128

        # 텐서 변환
        image_tensor = TF.to_tensor(image).unsqueeze(0)
        trimap_tensor = TF.to_tensor(Image.fromarray(trimap_np).convert("L")).unsqueeze(0)

        # trimap을 3단계 값으로 정규화
        trimap_tensor[trimap_tensor > 0.9] = 1.0
        trimap_tensor[(trimap_tensor >= 0.1) & (trimap_tensor <= 0.9)] = 0.5
        trimap_tensor[trimap_tensor < 0.1] = 0.0

        input_data = {"image": image_tensor.to(device), "trimap": trimap_tensor.to(device)}

        print(f"   추론 시작 (입력: {image_tensor.shape})")
        with torch.no_grad():
            output = model(input_data)

        # GPU 텐서 정리
        del input_data, image_tensor, trimap_tensor
        torch.cuda.empty_cache()

        print(f"   추론 완료, 출력 타입: {type(output)}, shape: {getattr(output, 'shape', 'N/A')}")

        # output은 numpy array (H, W) values 0-255
        if isinstance(output, np.ndarray):
            alpha_np = output
        elif hasattr(output, 'cpu'):
            alpha_np = output.cpu().float().numpy()
        else:
            alpha_np = np.array(output)

        if alpha_np.ndim == 3:
            alpha_np = alpha_np[0] if alpha_np.shape[0] == 1 else alpha_np.squeeze()

        if alpha_np.max() <= 1.0:
            alpha_np = np.clip(alpha_np * 255, 0, 255).astype(np.uint8)
        else:
            alpha_np = np.clip(alpha_np, 0, 255).astype(np.uint8)

        # 원본 크기로 alpha 복원
        alpha_img = Image.fromarray(alpha_np)
        if alpha_img.size != orig_size:
            alpha_img = alpha_img.resize(orig_size, Image.Resampling.LANCZOS)

        # RGBA 합성 (원본 크기 이미지 사용)
        orig_image = Image.open(io.BytesIO(image_data))
        orig_image = ImageOps.exif_transpose(orig_image).convert("RGB")
        result = orig_image.copy()
        result.putalpha(alpha_img)

        elapsed = time.time() - start_time
        print(f"✅ DiffMatte 완료: {orig_size[0]}x{orig_size[1]} (처리: {image.size[0]}x{image.size[1]}) | {elapsed:.2f}초")

        buf = io.BytesIO()
        result.save(buf, format="WEBP", quality=95, lossless=False)
        buf.seek(0)
        return Response(content=buf.getvalue(), media_type="image/webp")

    except Exception as e:
        clear_gpu_memory()
        print(f"❌ DiffMatte 오류: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"DiffMatte 오류: {str(e)}")


@app.get("/health")
async def health_check():
    """서버 상태 확인"""
    return JSONResponse(content={
        "status": "ok",
        "device": device,
        "dtype": str(dtype),
        "ryan_engine": RYAN_ENGINE_AVAILABLE,
        "loaded_models": list(loaded_models.keys()) + (["ben2"] if ben2_model is not None else []) + (["sam2"] if sam2_predictor is not None else []) + (["sam2_amg"] if sam2_mask_generator is not None else []) + (["mematte"] if mematte_model is not None else []),
        "sam2_available": SAM2_AVAILABLE,
        "gdino_available": GDINO_AVAILABLE,
        "vitmatte_available": VITMATTE_AVAILABLE
    })

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 5001))
    workers = int(os.environ.get("WORKERS", 1))
    uvicorn.run("server:app", host="0.0.0.0", port=port, workers=workers,
                h11_max_incomplete_event_size=1024*1024,
                timeout_keep_alive=120)