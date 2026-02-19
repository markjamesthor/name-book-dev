# 몽비 테스트 프로젝트

아이 사진을 배경 제거하고 포즈를 분석하여 인터랙티브한 스토리북을 생성하는 웹 애플리케이션입니다.

## 아키텍처

```
[브라우저] ──→ localhost:8080 (Python HTTP 서버, 프론트엔드)
    │
    ├─ LAN 접속 ──→ 59.10.238.17:5001 (Windows RTX 서버)
    └─ 외부 접속 ──→ ai.monviestory.co.kr (Cloudflare Tunnel) ──→ Windows RTX 서버
```

## 서버 구성

### AI 서버 (Windows RTX 4070 Super)

- **IP**: `59.10.238.17`, **Port**: `5001`
- **GPU**: RTX 4070 Super (CUDA, FP16, 12GB VRAM)
- **모델**: portrait (BiRefNet), ben2, hr-matting
- **서버 코드**: `C:\Documents and Settings\connect\automation-prototype\automation-prototype\`
- **Git**: `git@github.com:monviestory/automation-prototype-v1.git` (deploy key, read-only)

#### 서버 시작

```bash
# SSH 접속
ssh -i ~/.ssh/id_win_server taeho@59.10.238.17

# 서버 실행
cd "C:\Documents and Settings\connect\automation-prototype\automation-prototype"
set PYTHONIOENCODING=utf-8
python server.py
```

#### 서버 헬스 체크

```bash
curl http://59.10.238.17:5001/health
```

### Cloudflare Tunnel (고정 도메인)

- **도메인**: `https://ai.monviestory.co.kr`
- **터널 이름**: `monvie-ai`
- **터널 ID**: `041c6a84-bda7-4b1d-b9ef-1cc0844e576c`
- **Config**: `C:\Users\taeho\.cloudflared\config.yml`

#### 터널 시작

```bash
cloudflared tunnel run monvie-ai
```

### 프론트엔드 서빙

```bash
# 로컬 (Mac)
python3 -m http.server 8080
# → http://localhost:8080/book-preview.html
```

### GitHub Pages 배포

- **소스 repo**: `monviestory/automation-prototype-v1` (private)
- **배포 repo**: `markjamesthor/name-book-dev` (public)
- **URL**: https://markjamesthor.github.io/name-book-dev/book-preview.html
- **방법**: `/tmp`에 `name-book-dev` clone → 파일 복사 → commit & push

## 배포 워크플로우

```bash
# 1. Mac에서 코드 수정 & 커밋 & push
git add ... && git commit -m "..." && git push origin main

# 2. Windows에서 pull
ssh -i ~/.ssh/id_win_server taeho@59.10.238.17
cd "C:\Documents and Settings\connect\automation-prototype"
git pull origin main

# 3. 서버 재시작 (필요 시)
# 기존 프로세스 종료 후 다시 실행

# 4. GitHub Pages 배포 (필요 시)
cd /tmp && rm -rf name-book-dev
git clone https://github.com/markjamesthor/name-book-dev.git
cp -r automation-prototype/{book-preview.html,js,css,configs,NAME} /tmp/name-book-dev/
cd /tmp/name-book-dev && git add -A && git commit -m "sync" && git push
```

## API 엔드포인트

### POST /remove-bg

배경 제거 API. `model` 파라미터로 모델 선택.

```bash
curl -X POST "http://59.10.238.17:5001/remove-bg?model=portrait" \
  -F "file=@photo.jpg" -o output.webp
```

모델 옵션: `portrait`, `ben2`, `hr-matting`

### POST /smart-crop

스마트 크롭 (인물 감지 + 키포인트 기반 크롭 좌표 계산)

```bash
curl -X POST "http://59.10.238.17:5001/smart-crop?crop_mode=person&seg_size=512" \
  -F "file=@photo.jpg"
```

### GET /health

서버 상태 확인

## 기술 스택

- **프론트엔드**: Vanilla JS, HTML5, CSS3
- **백엔드**: FastAPI, PyTorch, Transformers (Python)
- **AI 모델**: BiRefNet-portrait, BEN2, BiRefNet-hr-matting
- **인프라**: Cloudflare Tunnel, GitHub Pages
- **테스트**: Playwright
