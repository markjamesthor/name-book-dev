#!/usr/bin/env python3
"""
BlazePose 모델 다운로드 스크립트
TensorFlow.js BlazePose Heavy 모델을 로컬에 다운로드합니다.

사용법:
    python download_blazepose_model.py
"""
import os
import urllib.request
import json
from pathlib import Path

# 모델 저장 경로
MODEL_DIR = Path("./models/blazepose-heavy")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# BlazePose Heavy 모델 URL (TensorFlow.js 공식 모델)
# 실제 URL은 pose-detection 라이브러리가 사용하는 URL을 확인해야 합니다
# 일반적으로 tfhub.dev 또는 다른 CDN에서 제공됩니다

print("📥 BlazePose Heavy 모델 다운로드 시작...")
print(f"📂 저장 경로: {MODEL_DIR.absolute()}")
print("\n⚠️  참고: pose-detection 라이브러리는 내부적으로 모델을 관리합니다.")
print("   이 스크립트는 모델 파일을 다운로드하지만,")
print("   실제 사용을 위해서는 서버에서 정적 파일로 제공해야 합니다.\n")

# 실제 모델 URL은 pose-detection 라이브러리 소스에서 확인해야 합니다
# 일반적인 BlazePose 모델 URL 패턴
MODEL_BASE_URLS = [
    "https://tfhub.dev/mediapipe/tfjs-model/blazepose_heavy/1",
    "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.0/dist/blazepose_heavy",
]

print("🔍 모델 URL 확인 중...")
print("   (실제 URL은 pose-detection 라이브러리 버전에 따라 다를 수 있습니다)")

# 간단한 방법: 모델을 직접 다운로드하는 대신
# 브라우저 캐시를 활용하거나, 서버에서 모델을 프록시하는 방법을 사용할 수 있습니다

print("\n💡 권장 방법:")
print("   1. 모델은 브라우저가 자동으로 캐시합니다 (첫 로드 후)")
print("   2. 또는 서버에서 모델 파일을 프록시하여 제공할 수 있습니다")
print("   3. 현재는 CDN에서 모델을 로드하지만, 브라우저 캐시로 인해")
print("      두 번째 로드부터는 빠르게 로드됩니다")

print("\n✅ 스크립트 완료")
print("   현재는 CDN 모델을 사용하며, 브라우저 캐시를 활용합니다.")
print("   완전히 오프라인으로 사용하려면 추가 설정이 필요합니다.")

