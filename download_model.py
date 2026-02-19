# download_model.py (최종_완벽버전.py)
from huggingface_hub import snapshot_download
import os

# 저장할 경로
save_directory = "./models/birefnet-portrait"

print(f"📥 모델 저장소 통째로 다운로드 시작... ({save_directory})")
print("⚠️ 모델 가중치와 파이썬 코드를 모두 가져옵니다 (약 1GB)")

try:
    # snapshot_download는 저장소의 모든 파일을 그대로 받아옵니다.
    # ignore_patterns로 불필요한 파일은 제외합니다.
    snapshot_download(
        repo_id="ZhengPeng7/BiRefNet-portrait",
        local_dir=save_directory,
        local_dir_use_symlinks=False, # 윈도우/맥 호환성을 위해 실제 파일 다운로드
        ignore_patterns=["*.md", "*.gitattributes"] # 잡동사니 제외
    )
    
    print("\n✅ 다운로드 100% 완료!")
    print("이제 폴더 안에 .py 파일들이 있는지 확인해보세요.")
    print("server.py를 실행하면 됩니다.")

except Exception as e:
    print(f"\n❌ 다운로드 실패: {e}")