# 몽비 테스트 - AI 자동화 동화책 제작 PoC

## 프로젝트 컨텍스트

### 핵심 목표
- AI 기반 동화책 자동 생성
- 인쇄 사고 방지가 최우선

### 아키텍처 결정사항
- 사진 교체 시 반드시 경고창 표시
- Pre-flight Check 필수
- AI 선택 이유 설명(Explainability) 포함

### 주의사항
- 프론트엔드에 로직 몰지 말 것
- 업로드 직후 사진 구성 분석 필요

---

## 프로젝트 개요
AI가 아이 사진을 분석하고, 배경을 제거하여 동화책 장면에 합성하는 자동화 시스템의 개념 증명(PoC) 프로젝트입니다.

## 기술 스택
- **프론트엔드:** Vanilla JS (ES Modules), HTML5, CSS3
- **AI 모델:** TensorFlow.js + BlazePose (포즈 감지)
- **백엔드:** Python FastAPI (배경 제거 서버)
- **서버 구성:** 메인(Windows/RTX), 백업(Mac/Local) Failover 구조

## 디렉토리 구조
```
/
├── index.html          # 메인 HTML
├── css/main.css        # 스타일시트
├── js/
│   ├── app.js          # 메인 애플리케이션 로직
│   ├── utils.js        # 유틸리티 (서버 통신, 드래그, 토스트 등)
│   └── pose.js         # 포즈 감지 및 분류 로직
├── image_3.png         # 배경 이미지 (캠핑장)
├── rock.png            # 돌 레이어 이미지
└── server/             # 배경 제거 서버 (Python)
```

## 핵심 기능

### 1. 사진 분석 및 분류
- BlazePose로 33개 관절 포인트 감지
- 발끝(31, 32) 신뢰도 기반 분류:
  - **good:** 전신이 완전히 보이는 사진
  - **suspicious:** 불확실한 사진
  - **cut:** 신체 일부가 잘린 사진
  - **multi:** 0명 또는 두 명 이상 감지된 사진 (동화책 생성 제외)

### 2. 얼굴 감지 로직 (face-api.js)
face-api.js의 TinyFaceDetector를 사용하여 얼굴 감지 후, 0명 또는 2명 이상이면 multi로 분류

**메인 인물 판별 기준:**
- 얼굴 크기가 이미지 면적의 2% 이상

**처리 흐름:**
1. `detectFaces()`로 이미지에서 모든 얼굴 감지 (face-api.js)
2. `detectMainSubjects()`로 얼굴 크기 2% 이상인 인물만 필터링
3. 메인 인물이 0명 또는 2명 이상이면 `multi` 카테고리로 분류
4. `multi` 카테고리 사진은:
   - 대시보드에서 비활성화 표시 (반투명)
   - 클릭해도 선택 불가
   - `getAllPhotos()`에서 제외되어 동화책 생성에 사용 안 됨

**코드 위치:** `js/pose.js` - `detectFaces()`, `detectMainSubjects()` 함수

### 3. 적극적 방어(Active Guardrail) 시스템
- 사진 교체 시 리스크 있는 사진(suspicious, cut)에 대해 confirm() 경고
- 사용자가 취소하면 교체 차단 (방어 성공)

### 4. 스토리 템플릿 매칭
- 페이지별 미션 요구사항 정의 (전신/상반신/자유)
- AI가 사진을 미션에 매칭하고 적합도 표시
- 배지: [미션: 전신 사진 필요] [매칭: 적합]

### 5. Failover 시각화
- 메인 서버 응답 없음 시 백업 서버 자동 전환
- 토스트 메시지로 전환 상태 실시간 표시
- 설정(⚙️) 버튼으로 서버 URL 변경 가능 (localStorage 저장)

## 서버 설정
- **메인 서버:** `http://172.30.1.51:5000` (Windows/RTX)
- **백업 서버:** `http://localhost:5001` (Mac/Local)
- **Connect Timeout:** 0.5초
- **Read Timeout:** 30초

## 실행 방법
```bash
# 서버 실행 (server/ 디렉토리에서)
python main.py

# 프론트엔드 (Live Server 등으로 실행)
# index.html을 브라우저에서 열기
```

## 주요 상수 (js/utils.js)
- `MIN_CONFIDENCE: 0.8` - 관절 신뢰도 기준값
- `FIXED_ROCK_SCALE_PERCENT: 15` - 돌 기본 크기
- `FIXED_Y_OFFSET: -70` - 돌 Y 오프셋

## 코드 컨벤션
- ES Modules 사용 (`import`/`export`)
- 한글 주석 및 로그 메시지
- 상태 관리는 `state` 객체에 집중
- DOM 요소는 `elements` 객체에 캐싱
