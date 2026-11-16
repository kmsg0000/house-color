# ChatGPT 안에서 쓰기 — "우리집 외벽 색 바꾸기" ChatGPT 앱

ChatGPT 대화창에 건물 사진을 올리고 **"벽은 따뜻한 베이지, 띠 부분은 진한 남색으로 해줘"** 처럼 말하면,
ChatGPT 가 사진을 보고 칠할 곳과 노루페인트 색을 정해서 이 앱 화면(대화창 안)에 결과를 보여 줍니다.
**ChatGPT 구독(Plus/Pro)으로 동작하므로 API 키가 필요 없습니다.**

```
[ChatGPT 대화]  사진 + "벽은 베이지로"
      │  ChatGPT 가 사진을 보고 판단 (칠할 곳 좌표, 색)
      ▼
[MCP 서버]  paint_house 도구 ─ 색을 실제 노루페인트 칩으로 맞춤 / 사진 전달
            find_colors 도구 ─ 노루페인트 6,864색 검색
      ▼
[앱 화면(위젯)]  대화창 안에서 칠한 결과 표시 · 비교 · 손으로 고치기 · 저장
```

## 1단계. 서버 올리기 (둘 중 하나)

ChatGPT 가 접속할 수 있도록 이 폴더(`chatgpt-app`)를 인터넷에 올려야 합니다. 주소 끝은 `/mcp` 입니다.

### 방법 A — Cloudflare 무료 계정 + GitHub 자동 배포 (권장)

1. https://dash.cloudflare.com 에 무료 가입합니다.
2. 오른쪽 위 프로필 → **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" 템플릿 → Continue → Create Token** → 토큰을 복사합니다.
3. Cloudflare 첫 화면 오른쪽(또는 Workers 메뉴)에 보이는 **Account ID** 도 복사합니다.
4. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret** 에서 두 개를 추가합니다.
   - `CLOUDFLARE_API_TOKEN` = 2번 토큰
   - `CLOUDFLARE_ACCOUNT_ID` = 3번 Account ID
5. 저장소의 **Actions** 탭 → "앱 만들기" → **Run workflow**. 끝나면 "ChatGPT 앱 서버 배포" 단계 로그에
   `https://house-color-mcp.<내계정>.workers.dev` 주소가 나옵니다. **ChatGPT 에 넣을 주소는 그 뒤에 `/mcp` 를 붙인 것**입니다.
   - 이후 앱을 고쳐서 올릴 때마다 자동으로 다시 배포됩니다.

### 방법 B — ChatGPT Sites 에 올리기

ChatGPT(Work 또는 Codex)에서 `@Sites` 를 부르고 이렇게 요청해 보세요.
> "GitHub kmsg0000/house-color 저장소의 chatgpt-app 폴더를 사이트로 배포해줘. server.mjs 의 기본 export(fetch 핸들러)가 서버이고, /mcp 경로가 MCP 엔드포인트야."

(Sites 는 공개 베타라 계정에 따라 안 보이거나 동작이 다를 수 있습니다. 안 되면 방법 A 를 쓰세요.)

### (개발자용) 직접 실행

```
cd chatgpt-app
node build.mjs          # web/index.html 이 바뀌었으면 다시 생성
node node-server.mjs    # http://localhost:8787/mcp
```
로컬 주소는 ChatGPT 가 접속할 수 없으니 ngrok / cloudflared 같은 터널로 https 주소를 만들어 넣어야 합니다.

## 2단계. ChatGPT 에 연결하기 (개발자 모드)

1. ChatGPT(웹) → **설정 → 앱(Apps) → 고급 설정** → **개발자 모드** 를 켭니다. (Plus/Pro 필요)
2. **앱 만들기(Create app)** 를 누르고
   - 이름: `우리집 외벽 색 바꾸기`
   - MCP 서버 URL: `https://.../mcp` (1단계 주소)
   - 인증: **없음(No authentication)**
3. 만들기를 누르면 도구 목록에 `paint_house`, `find_colors` 가 보입니다.

> ChatGPT 화면의 메뉴 이름은 업데이트에 따라 조금 다를 수 있습니다. "Developer mode / 개발자 모드" 를 찾으면 됩니다.

## 3단계. 사용하기

새 대화에서 **＋ → 우리집 외벽 색 바꾸기** 를 고르거나 이름을 부른 뒤, 사진을 올리고 말합니다.

- "이 사진 외벽을 따뜻한 아이보리로, 띠 부분은 진한 회색으로 바꿔줘"
- "노루페인트 WT 1001 로 벽을 칠해줘"
- "모던한 느낌으로 어울리는 조합 추천해서 칠해줘"
- (결과가 나온 뒤) "창틀은 흰색으로", "벽을 조금 더 밝게"

앱 화면에서:
- **↩ AI가 한 것 되돌리기 / ✋ 직접 고치기** — 빠진 곳을 손으로 추가하거나 색을 바꿉니다.
- **완성 → 💾 저장** — 결과 사진을 ChatGPT 파일함에 저장합니다. (사진을 길게 누르거나 우클릭해서 기기에도 저장 가능)

### 나무·차 지우기
앱 안의 지우기는 기본 방식입니다. **뒤 배경까지 자연스럽게 살리려면** ChatGPT 에게
"먼저 이 사진에서 앞의 나무를 지운 사진을 만들어 주고, 그 사진으로 외벽 색을 바꿔줘" 라고 요청하세요.
ChatGPT 가 구독에 포함된 이미지 편집으로 나무를 지운 뒤 그 사진을 앱에 넘기도록 안내되어 있습니다.
(생성된 사진을 앱에 넘기는 동작은 ChatGPT 쪽 지원 여부에 따라 달라질 수 있습니다.)

## 참고
- 색상 데이터: 노루페인트 홈페이지 컬러차트(2026년 11월) — 노루컬러가이드 1,512 · Cover all 1,512 · NR 1,221 · PANTONE 2,619색
- 사진은 칠하기 처리를 위해 이 서버를 한 번 거쳐 앱 화면으로 전달되며, 서버에 저장하지 않습니다.
- 앱을 다른 사람에게 공개(ChatGPT 앱 디렉터리 등록)하려면 OpenAI 심사가 필요합니다. 개발자 모드는 본인 계정에서만 쓰는 용도입니다.
