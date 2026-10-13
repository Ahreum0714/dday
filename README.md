# 디데이 앱 설치 안내

GitHub Pages(화면) + Supabase(로그인·데이터) 무료 플랜으로 배포하는 디데이 웹앱이에요.

## 파일
| 파일 | 역할 |
|---|---|
| index.html, app.js | 앱 화면과 동작 |
| config.js | Supabase 주소와 키 (직접 채워 넣기) |
| manifest.webmanifest, sw.js, icons/ | 홈 화면 앱 설정, 아이콘, 오프라인 화면 |
| supabase/schema.sql | 데이터베이스와 접근 규칙 (Supabase에서 한 번 실행) |

## 1. Supabase 프로젝트와 데이터베이스
1. supabase.com → New project (Region: Northeast Asia (Seoul) 추천)
2. 왼쪽 SQL Editor → New query
3. `supabase/schema.sql` 내용을 붙여넣고, **맨 아래 `내-구글-이메일@gmail.com`을 내가 로그인할 구글 이메일로 바꾼 뒤** Run
4. Project Settings → API Keys 에서 **Project URL**과 **anon public 키**를 복사
   (화면에 Publishable key만 보이면 'Legacy API Keys' 탭의 anon 키를 쓰세요)
5. `config.js`의 두 값을 복사한 값으로 바꾸기

## 2. GitHub Pages에 올리기
1. GitHub → New repository → 이름 `dday`, **Public** → Create
2. Add file → Upload files → `index.html, app.js, config.js, manifest.webmanifest, sw.js`와 `icons` 폴더를 끌어다 놓고 Commit
3. Settings → Pages → Source: Deploy from a branch, Branch: `main` / `(root)` → Save
4. 1~2분 뒤 `https://<깃허브아이디>.github.io/dday/` 주소가 생겨요

## 3. Google 로그인 만들기 (Google Cloud Console)
1. console.cloud.google.com → 새 프로젝트 만들기
2. Google Auth Platform(또는 API 및 서비스 → OAuth 동의 화면) → 시작하기
   - 앱 이름: 디데이, 지원 이메일: 내 이메일, 대상: **외부**
   - 대상(Audience) 화면에서 **앱 게시(Publish app)** — 이메일·프로필만 쓰므로 별도 심사 없이 게시돼요
3. 클라이언트(Clients) → 클라이언트 만들기 → 유형: **웹 애플리케이션**
   - 승인된 JavaScript 원본: `https://<깃허브아이디>.github.io`
   - 승인된 리디렉션 URI: `https://<프로젝트주소>.supabase.co/auth/v1/callback`
     (Supabase의 Google 설정 화면에 'Callback URL'로 그대로 나와 있어요)
4. 만들어진 **클라이언트 ID**와 **클라이언트 보안 비밀번호** 복사

## 4. Supabase 로그인 설정
1. Authentication → Sign In / Providers → **Google** 켜기 → 클라이언트 ID와 보안 비밀번호 붙여넣기 → Save
2. 같은 화면에서 **Email** 로그인은 끄기 (구글로만 들어오게)
3. Authentication → URL Configuration
   - Site URL: `https://<깃허브아이디>.github.io/dday/`
   - Redirect URLs에도 같은 주소 추가

## 5. 아이폰에서 쓰기
1. Safari로 `https://<깃허브아이디>.github.io/dday/` 열기 → Google로 로그인
2. 공유 → **홈 화면에 추가** (이제 아이콘을 누르면 디데이 앱이 바로 열려요)
3. 상단 사람 아이콘 → 초대할 사람의 구글 이메일 입력 → 초대
4. 그 사람에게 앱 주소를 보내고, 그 사람이 한 번 로그인하면 디데이 수정 화면의 '함께 볼 사람'에 나타나요

## 앱을 고칠 때
파일을 바꿔서 GitHub에 다시 올리고, `sw.js`의 `VERSION` 숫자를 하나 올려 주세요(예: dday-v2). 그래야 폰에 저장된 예전 화면이 새 화면으로 바뀌어요.

## 보안 메모
- 저장소가 Public이라 config.js의 anon 키가 보이지만 괜찮아요. 데이터는 접근 규칙으로 보호돼서, 초대 목록에 없는 계정은 아무것도 읽거나 쓸 수 없어요.
- Supabase의 **service_role 키는 절대 config.js에 넣지 마세요.**
- 무료 플랜 Supabase 프로젝트는 1주일 넘게 아무도 쓰지 않으면 일시 정지될 수 있어요. 대시보드에서 Restore를 누르면 다시 살아나요.
