#!/bin/bash

# 몽비 테스트 + 라이언북 - 서버 실행 스크립트
# 사용법: ./start.sh

cd "$(dirname "$0")"

echo "🚀 프로젝트 시작"
echo "================================"

# 기존 프로세스 정리
pkill -f "uvicorn" 2>/dev/null
pkill -f "http.server 8080" 2>/dev/null
pkill -f "http.server 8081" 2>/dev/null
sleep 1

# 1. AI 서버 시작 (백그라운드) - 배경 제거
echo "🤖 AI 서버 시작 중 (포트 5001)..."
python3 -c "
import uvicorn
from server import app
uvicorn.run(app, host='0.0.0.0', port=5001)
" &
AI_PID=$!

# 2. 메인 웹 서버 시작 (포트 8080) - index.html
echo "🌐 메인 클라이언트 시작 중 (포트 8080)..."
python3 -m http.server 8080 &
WEB1_PID=$!

# 3. 라이언북 웹 서버 시작 (포트 8081) - ryan.html
echo "📚 라이언북 클라이언트 시작 중 (포트 8081)..."
python3 -m http.server 8081 &
WEB2_PID=$!

# 모델 로딩 대기
echo ""
echo "⏳ AI 모델 로딩 중... (약 10초)"
sleep 12

echo ""
echo "================================"
echo "✅ 서버 실행 완료!"
echo ""
echo "📱 메인 (index.html):    http://localhost:8080"
echo "📚 라이언북 (ryan.html): http://localhost:8081/ryan.html"
echo "🤖 AI 서버:              http://localhost:5001"
echo ""
echo "종료하려면 Ctrl+C를 누르세요"
echo "================================"

# 브라우저 열기
open "http://localhost:8080"
open "http://localhost:8081/ryan.html"

# 종료 시 프로세스 정리
trap "echo ''; echo '서버 종료 중...'; kill $AI_PID $WEB1_PID $WEB2_PID 2>/dev/null; echo '👋 종료 완료'; exit 0" SIGINT SIGTERM

# 대기
wait
