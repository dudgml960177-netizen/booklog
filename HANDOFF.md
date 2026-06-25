# 북로그 작업 핸드오프 (Claude용 인수인계)

> 폰/다른 기기의 Claude Code(claude.ai/code)로 이 repo를 열었을 때, **이 파일을 먼저 읽고** 맥락을 파악한 뒤 이어서 작업하세요.
> 사용자는 한국어로 소통합니다. 이 문서는 PC 로컬 세션의 대화 맥락을 옮겨둔 것입니다.

최종 업데이트: 2026-06-25

---

## 0. 가장 중요한 규칙 (절대 위반 금지)

1. **모바일/리디자인 디자인 작업을 production(실서비스)에 자동 반영하지 말 것.**
   - 사용자가 "이거 웹/앱에 반영해줘"라고 **명시적으로 요청한 버그·기능 수정만** `main`에 반영.
   - 디자인 리뉴얼은 반드시 **미리보기 브랜치**에서만. 실서비스(`main` → vercel 실배포)에 영향 가면 안 됨.
2. **웹과 앱 디자인은 코어가 달라야 함.** "웹은 웹대로, 앱은 앱대로." 데스크톱을 축소한 모바일 ❌.
3. 웹 리디자인은 항상 **테스트(미리보기) 페이지로 먼저 보여주고** 승인받은 뒤 반영.

---

## 1. 프로젝트 개요

- **북로그(BookLog)**: 독서 기록 웹앱. 실서비스 https://booklog-neon.vercel.app/
- 스택: **순수 HTML/CSS/JS SPA**(프레임워크 없음) + Chart.js + **Supabase**(인증/DB).
- 호스팅: **Vercel** (GitHub `main` 푸시 → 자동 실배포 / 다른 브랜치 푸시 → 미리보기 URL).
- GitHub: `dudgml960177-netizen/booklog` (작업 끝나면 **비공개 전환** 요청 있었음 — 아직 안 함).
- 앱화: **Capacitor** 선택(순수 TWA 아님). 이유 = 네이티브 푸시 알림 + 타이머/도서관 진행 중 다른 앱 위에 작은 팝업(heads-up). 앱 프로젝트 위치: `C:\Users\USER\booklog-app`, appId `com.booklog.app`. (안드로이드 스튜디오·JDK·SDK 설치 완료. `java`는 PATH에 없음.)

## 2. 브랜치 구조

| 브랜치 | 용도 | 배포 |
|---|---|---|
| `main` | **실서비스(production)** | vercel 실배포. 버그/기능 수정만. |
| `mobile-redesign` | 앱 디자인 레이어 + Capacitor server.url 타깃 | 미리보기 = 앱 테스트 |
| `web-redesign` | 웹 에디토리얼 리디자인 | 미리보기 (실서비스와 분리) |

- 미리보기 URL 형식: `booklog-git-<branch>-dudgml960177-netizens-projects.vercel.app`
  - 웹: `booklog-git-web-redesign-...vercel.app`
- 주의: **여러 세션이 병렬로 `main`의 app.js를 수정**함. 브랜치 app.js를 main에 통째 복사 ❌ → **수정마다 surgical하게** 개별 적용.

## 3. 파일 구조 / 반응형 레이어링

- `app.js` (~9000줄, 웹·앱 공용 메인 로직)
- `index.html` (브랜치마다 다름. web-redesign엔 `<aside class="web-side">` 사이드바 포함)
- `library.html` (도서관 기능, 웹+앱 공용)
- 앱(모바일) 레이어: `mobile.css`(@media max-width:640) / `mobile.js`
- 웹(에디토리얼) 레이어: `web.css`(@media min-width:880) / `web.js`
- `service-worker.js` (오프라인 + notificationclick)
- 패널 전환: 전역 `sw('panelName', btnEl)`. 패널 id: `p-books`/`p-quotes`/`p-record`/`p-graph`/`p-board`.
- 테마/모드 게이팅: `body.app-on`, `body.mode-record`, `body.theme-*`.
- 게이지: conic-gradient + mask 도넛. 테마 틴트: `color-mix(in srgb,...)`.
- PostgREST 기본 1000행 제한 → books/quotes 쿼리에 `.limit(10000)`.

## 4. 디자인 방향 (승인된 것)

- **웹(web-redesign)**: 에디토리얼/매거진. 좌측 사이드바(아이콘+텍스트), 와이드 그리드, 도넛 게이지, 빈티지책/카툰 일러스트 느낌. 선은 **분명하되 1.5px 정도**(너무 두껍지 않게). 색은 좀 튀어도 OK. 베이스 크림브라운.
  - 사이드바: 로고 옆 **프로필 동그라미**(→openProfile), 하단 **⚙ 설정 메뉴**(책 불러오기·백업·덮어쓰기 → openModal('modal-backup') / 카테고리 관리 → openCategories / 프로필 → openProfile).
  - 홈: 이어읽기 히어로 + 오늘의 문장(=사용자 본인이 저장한 문장 중 랜덤) + 사이드바 통계. (web.js `renderWebHome`)
- **앱(mobile-redesign)**: 하단 탭바, 앱 느낌. 크림브라운 베이스 + 보조 톤(theme-sage/slate/mauve/clay). 컬러 카드 + 도넛 게이지. 문장 게시판은 **카드 폴더-스와이프**("드르륵 뒤지듯 + 뿅", 검색 유지).

## 5. 완료된 production(main) 버그 수정 (참고)

로딩 무한 hang 해결(`_hardClearSession` + 15s watchdog), 문장카드 공유모달 흰 텍스트, 읽고싶음 달력 방어, 북적북적 CSV 메모행 가드, 별점 정렬, 밑줄 페이지순, 파도타기 뷰어 정렬 드롭다운, 산책 댓글 우측정렬, 도서관 테이블 overflow, 도서관 퇴장버튼 상단 이동.

## 6. 남은 할 일 (TODO)

- [ ] **웹 리디자인**: 홈(서재) 외 나머지 화면(문장/기록/통계/산책)도 에디토리얼로. (다음 단계 후보)
- [ ] **앱 리디자인**: 통계 = 컬러카드+도넛 / 문장 폴더-스와이프.
- [ ] **웹 다크모드 토글**(라이트/다크/현재) — 제일 크고 마지막에.
- [ ] 앱: Capacitor 빌드 / FCM 푸시 / Play Store 패키징.
- [ ] 승인 후: 웹 리디자인을 production에 연결.
- [ ] 모든 작업 후 GitHub repo **비공개 전환** (gh CLI 미설치 → 웹 UI로 안내 필요).

## 7. 현재 진행 위치 (2026-06-25 기준)

- `web-redesign` 브랜치에서 **사이드바 프로필 동그라미 + ⚙ 설정 메뉴(데이터 불러오기/덮어쓰기 접근성)** 완료·푸시(commit 17af177, web.css/web.js `?v=2`). 사용자 확인 대기 중이었음.
- 다음: 웹의 다른 화면 에디토리얼화 or 홈 추가 다듬기 (사용자 선택 대기).

## 8. 환경 제약 (Claude 작업 시)

- PC 로컬 세션의 브라우저 뷰포트가 1536px(데스크톱)에 고정 → **모바일 렌더링은 직접 못 봄**, 사용자 폰 스크린샷에 의존.
- 데스크톱(웹 리디자인)은 볼 수 있으나 로그인 월 때문에 로그인 후 화면은 제한.

## 9. 테스트 계정

- 별도 테스트 계정 존재(이메일은 사용자에게 문의). **비밀번호는 이 문서에 기록하지 않음.** Claude는 비밀번호 입력 불가 — 사용자가 직접 로그인.
