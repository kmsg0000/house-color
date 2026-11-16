# 우리집 외벽 색 바꾸기 — 설치판 만들기 안내

건물 사진에 노루페인트(노루컬러가이드 · Cover all · NR · PANTONE, 총 6,864색)를 칠해 보는 프로그램입니다.
이 폴더 하나로 **안드로이드 APK**, **Windows 설치파일(.exe)**, **Mac 설치파일(.dmg)** 을 만들 수 있습니다.

> **ChatGPT 안에서 쓰기(API 키 없이 ChatGPT 구독으로):** `chatgpt-app/README.md` 를 보세요.

> 그냥 PC에서 바로 쓰고 싶다면: `web/index.html` 파일을 크롬이나 엣지로 열면(더블클릭) 설치 없이 바로 실행됩니다.

---

## 방법 A. GitHub에서 자동으로 만들기 (개발 지식 없이 가능, 무료)

1. **github.com** 에 가입하고 로그인합니다.
2. 오른쪽 위 **＋ → New repository** 를 누릅니다.
   - 이름: `house-color` (아무거나 가능)
   - **Private(비공개)** 를 고르는 것을 권장합니다.
   - **Create repository** 를 누릅니다.
3. 새 저장소 화면에서 **uploading an existing file** 링크를 누르고,
   이 압축을 푼 폴더 **안의 내용물 전부**(`web`, `desktop`, `android`, `.github`, `README.md`)를 끌어다 놓은 뒤 **Commit changes** 를 누릅니다.
   - ⚠ 컴퓨터에 따라 이름이 점(.)으로 시작하는 `.github` 폴더가 안 보이거나 안 올라갈 수 있습니다.
     그럴 때는 저장소에서 **Add file → Create new file** 을 누르고 파일 이름 칸에
     `.github/workflows/build.yml` 이라고 적은 뒤, 이 폴더의 같은 파일 내용을 복사해 붙여 넣고 저장하세요.
4. 저장소 위쪽 **Actions** 탭을 누릅니다. (처음이면 "I understand… enable" 버튼을 눌러 켭니다)
   "앱 만들기" 작업이 자동으로 돌기 시작합니다. 10~15분 정도 걸립니다.
5. 다 끝나면(초록색 ✔) 저장소 오른쪽의 **Releases → 최신 버전** 에서 내려받습니다.
   - `HouseColor.apk` → 안드로이드 휴대폰용
   - `HouseColor-Setup-1.0.0.exe` → Windows PC용
   - `HouseColor-Setup-1.0.0.dmg` → Mac용

## 휴대폰에 APK 설치하기

1. `HouseColor.apk` 를 휴대폰으로 옮깁니다 (카카오톡 "나에게 보내기", 구글 드라이브, USB 등).
2. 휴대폰에서 파일을 누르면 "출처를 알 수 없는 앱" 경고가 나옵니다 → **설정 → 이 출처 허용** 을 켜고 **설치** 를 누릅니다.
3. 홈 화면에 **외벽 색 바꾸기** 아이콘이 생깁니다.
   - 사진 고르기에서 **카메라로 바로 찍기**도 됩니다.
   - 저장한 사진은 **갤러리 → Pictures/외벽색바꾸기** 에 들어갑니다.
   - 아이폰은 APK를 쓸 수 없습니다. 아이폰은 웹 링크(claude.ai)로 사용하세요.

## PC에 설치하기

- **Windows**: `.exe` 를 실행 → "Windows의 PC 보호" 파란 창이 뜨면 **추가 정보 → 실행** → 설치 후 바탕화면 아이콘으로 실행.
  (인증서 서명이 없는 개인용 프로그램이라 이 경고가 뜨는 것은 정상입니다)
- **Mac**: `.dmg` 를 열어 앱을 응용 프로그램 폴더로 끌어 넣고, 처음 한 번은 앱을 **우클릭 → 열기** 로 실행합니다.
- 저장한 사진은 **사진(Pictures) 폴더**에 저장됩니다.

---

## AI 기능 (말로 시키기) 사용하기

### PC 설치판: ChatGPT 구독으로 로그인 (API 키 필요 없음)

ChatGPT **Plus 또는 Pro** 구독이 있으면 키 없이 쓸 수 있습니다.

1. 사진을 연 뒤 🤖 상자의 **⚙ AI 설정** → **ChatGPT 로그인 (구독)** → **ChatGPT로 로그인**.
2. 브라우저에 ChatGPT 로그인 화면이 뜹니다. 로그인하고 **플랜 사용을 허용**한 뒤 프로그램으로 돌아옵니다.
3. "✅ 로그인됨" 이 보이면 **저장**. 이제 AI 명령이 구독 사용량으로 작동합니다.
   - 사용량은 ChatGPT 설정 → Login connections 에서 확인·제한·연결 해제할 수 있습니다.
   - 로그인 정보는 컴퓨터의 보안 저장소에 암호화되어 저장됩니다.
   - (OpenAI 의 Sign in with ChatGPT 공개 OAuth 흐름을 직접 구현했습니다. 개인용 로컬 앱 용도입니다.)

### API 키로 쓰기 (PC · 휴대폰 공통)

설치판에서는 본인의 AI API 키를 넣어야 AI 기능이 켜집니다. 키가 없어도 손으로 하는 기능은 모두 됩니다.

1. 프로그램에서 사진을 연 뒤, 🤖 상자의 **⚙ AI 설정** 을 누릅니다.
2. **Claude / ChatGPT / Gemini** 중 하나를 고르고 키를 붙여 넣은 뒤 **저장**.
   - Claude 키: console.anthropic.com → API Keys
   - ChatGPT 키: platform.openai.com → API keys
   - Gemini 키: aistudio.google.com → Get API key
3. 이제 "벽은 밝은 베이지, 지붕은 진한 회색으로", "앞에 있는 나무 지워줘" 처럼 적으면 AI가 사진을 보고 칠해 줍니다.

- 키는 그 기기 안에만 저장되고, 고른 AI 회사로만 전송됩니다.
- AI를 쓸 때마다 그 회사에 사용료가 청구됩니다(사진 한 장 명령 1회에 보통 몇 원~수십 원 수준). 키는 남에게 알려주지 마세요.
- 기본 모델 이름: Claude `claude-sonnet-5-5`, ChatGPT `gpt-6.1-terra`, Gemini `gemini-flash-latest`.
  나중에 모델이 바뀌어 오류가 나면 ⚙ AI 설정 → "모델 이름(고급)" 에서 바꿀 수 있습니다.
- 휴대폰에서는 키보드의 🎤 음성 입력 버튼으로 말해서 입력할 수 있습니다.

---

## 방법 B. 개발 도구로 직접 만들기 (개발자용)

- **APK**: Android Studio 에서 `android` 폴더를 열고 **Build → Build APK(s)**.
  (Gradle 8.14 / AGP 8.7 / JDK 17. 커맨드라인: `cd android && gradle assembleRelease`)
- **PC 설치파일**: Node.js 22 설치 후
  ```
  cd desktop
  npm install
  npm run dist:win     # 또는 dist:mac
  ```
- 웹 앱을 고쳤다면 `web/index.html` 을 바꾸면 됩니다 (자동 빌드 시 양쪽에 복사됨).

## 서명 키에 대해

`android/app/release.keystore` 는 APK 서명용 키입니다. 같은 키로 서명해야 나중에 새 버전을 **업데이트로** 설치할 수 있으니 지우지 마세요.
(비밀번호 `housecolor2026`. 저장소를 공개로 만들 경우 GitHub Secrets 에 `KEYSTORE_*` 값을 넣어 다른 키를 쓰는 것을 권장합니다)

## 알아 두기

- 화면의 색은 모니터·휴대폰마다 조금씩 다르게 보입니다. 최종 결정 전 실제 페인트 색견본으로 꼭 확인하세요.
- 색상 데이터는 노루페인트 홈페이지 컬러차트(2026년 11월 기준)에서 가져왔습니다.
- 나무·차 지우기는 주변 벽을 이어 붙여 채우는 방식이라, 큰 물체나 복잡한 배경에서는 자국이 남을 수 있습니다. 작게 여러 번 나눠 지우면 더 자연스럽습니다.
