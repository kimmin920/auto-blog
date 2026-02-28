# Blog Auto MVP (Headless-first)

스타일링 없이 기능 중심으로 만든 블로그 자동화 MVP입니다.

## 이번 단계에서 구현된 핵심

1. SQLite 영속 저장 (`data/blog-auto.sqlite`)
2. LLM provider 선택형 스타일 리라이트 (`openai` / `cloudflare`)
3. Threads OAuth 로그인 + 포스트 수집
4. `npm run dev` 시 서버 + HTTPS 터널(cloudflared) 동시 실행
5. 소셜 카드 UI + 포스트 선택 후 블로그 초안 생성

## 기능

1. 블로그 링크 수집 후 글쓰기 스타일 프로필 생성
2. 인스타 링크 수집(공개 페이지 메타/텍스트 기준)
3. Threads 로그인(OAuth) 후 내 스레드 포스트 수집
4. 소셜 포스트 카드에서 선택한 포스트만 블로그 초안 생성
5. LLM provider 선택(OpenAI / Cloudflare Workers AI)
6. 결과를 `Plain Text`와 `HTML` 포맷으로 제공
7. 자동 평가 제공
   - 문체 유사도 점수
   - 글 품질 점수
   - 구조 유사도(도입/전개/요약 패턴)
   - 개선 제안/상세 진단
8. 사진 업로드 AI 분석
   - 사물/배경/텍스트(OCR)/활용 포인트를 상세 문장으로 생성

## 설치

```bash
npm install
```

## 실행

```bash
npm run dev
```

- `app`: 로컬 서버 실행
- `tunnel`: cloudflared Quick Tunnel URL 출력 (`https://*.trycloudflare.com`)

## Cloudflare Workers AI 사용 설정 (무료 시작)

1. Cloudflare 가입 후 대시보드 접속
2. `AI` 또는 `Workers AI`에서 API 사용 활성화
3. `Account ID` 확인
4. API Token 생성
   - 최소 권한: Workers AI 실행 가능 권한
5. `.env` 설정

```env
LLM_PROVIDER=cloudflare
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_MODEL=@cf/meta/llama-3.1-8b-instruct
```

6. 앱에서 `블로그 글 생성하기` 전, LLM Provider를 `Cloudflare Workers AI`로 선택

## Threads OAuth 설정 방법

1. `npm run dev`로 터널 URL 확인
2. Threads 앱의 Redirect URI 등록
   - `https://<quick-tunnel-domain>/auth/threads/callback`
3. `.env`의 `THREADS_REDIRECT_URI=AUTO` 권장
4. 로그인은 반드시 터널 도메인에서 시작

## 환경변수

- `LLM_PROVIDER`: 기본 provider (`openai` or `cloudflare`)
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `OPENAI_VISION_MODEL`
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_MODEL`
- `CLOUDFLARE_VISION_MODEL`
- `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI`, `THREADS_SCOPE`
- `ADMIN_PANEL_KEY` (관리자 DB 콘솔 `/admin` 접근 키)
- `SSL_KEY_PATH`, `SSL_CERT_PATH`
- `DB_PATH`, `UPLOAD_DIR`, `PORT`, `HOST`

## 배포 (실사용 테스트 권장: Render)

이 프로젝트는 SQLite(`DB_PATH`) + 업로드 파일(`UPLOAD_DIR`)을 로컬 파일시스템에 저장하므로,
반드시 **Persistent Disk/Volume**이 있는 플랫폼으로 배포하는 것을 권장합니다.

### 빠른 배포 순서

1. GitHub에 현재 저장소 push
2. Render 대시보드에서 `Blueprint`로 배포
3. 저장소 루트의 `render.yaml`을 사용해 Web Service + Disk 생성
4. Render 환경변수에서 최소한 아래를 채우기
   - `OPENAI_API_KEY`
   - `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI` (Threads 기능 사용 시)
5. 배포 완료 후 서비스 URL 접속

`render.yaml` 기본값:
- `DB_PATH=/var/data/blog-auto.sqlite`
- `UPLOAD_DIR=/var/data/uploads`
- `HOST=0.0.0.0`

즉, SQLite와 업로드가 모두 디스크(`/var/data`)에 영속 저장됩니다.

## 관리자 DB 콘솔

- 경로: `/admin`
- 접근: `ADMIN_PANEL_KEY` 환경변수 설정 후 관리자 키 로그인
- 권한: 로그인한 관리자는 사용자 이메일 일치 여부와 무관하게 전체 테이블 조회/수정/삭제 가능
- 주의: 운영 환경에서는 반드시 강한 키를 사용하고 외부에 노출하지 마세요.

## API

### 1) 스타일 프로필 생성

`POST /api/style-profile`

### 2) 인스타 콘텐츠 수집

`POST /api/instagram-ingest`

### 3) Threads 콘텐츠 수집

`POST /api/threads-ingest`

### 4) 블로그 초안 생성

`POST /api/generate-draft`

```json
{
  "userId": "kimi",
  "useLLM": true,
  "llmProvider": "cloudflare",
  "selectedPostIds": ["instagram:...", "threads:..."]
}
```

응답 draft에는 `evaluation`(styleSimilarity, qualityScore, suggestions, detail)이 포함됩니다.

### 5) 상태 조회

`GET /api/state?userId=kimi`

### 6) 이미지 분석 업로드 (폼)

`POST /actions/image-analyze` (multipart/form-data)

## 주의사항

- 인스타 스크래핑 데이터는 페이지 구조/정책에 따라 편차가 있습니다.
- Quick Tunnel URL은 실행할 때마다 변경될 수 있습니다.
- LLM 적용 실패 시에도 기본 초안을 반환합니다.
