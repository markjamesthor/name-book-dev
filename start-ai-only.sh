#!/bin/bash

# AI 서버만 실행하는 스크립트 (studio와 함께 사용)
# 사용법: ./start-ai-only.sh

cd "$(dirname "$0")"

echo "🤖 AI 서버 시작 중 (포트 5001)..."

# 기존 프로세스 정리
pkill -f "uvicorn.*server.*5001" 2>/dev/null
sleep 1

# AI 서버 시작 (포그라운드)
python3 -c "
import uvicorn
from server import app
uvicorn.run(app, host='0.0.0.0', port=5001)
"
