# 쇼츠블럭 (Shorts Blocker)

YouTube 쇼츠 시청 시간을 하루 N분으로 제한하고, 피드/사이드바의 쇼츠를 숨겨주는 Chrome 확장 프로그램. 한국어 UI. Chrome Web Store 출시 준비 중.

- **Repo**: https://github.com/dhkd3213/shorts-blocker (public, MIT)
- **Tagline**: "오늘 쇼츠, 얼마나 봤어?"
- **스토어 표시명**: `쇼츠블럭 - 쇼츠 차단·시간제한·숨기기` (manifest `name`. 툴바 툴팁은 `action.default_title`="쇼츠블럭")
- **현재 버전**: manifest 0.2.2

## 기술 스택 / 규칙

- Chrome **Manifest V3**, **순수 바닐라 JS (빌드 도구 없음)**, 런타임 의존성 0
- 서비스워커는 ES module (`"type": "module"`). **콘텐츠 스크립트는 import 불가** → 공유 로직은 인라인 복제 (state.js의 `isOffActive` ↔ content.js의 `isOffActiveLocal`, 동기화 유지)
- 단위 테스트: `node:test` (`npm test`). 순수 로직(`src/lib/state.js`)만 테스트. Chrome 연동부는 수동 검증.
- UI 한국어. 폰트는 외부 의존 없이 시스템 스택(Pretendard→맑은고딕 폴백).

## 명령어

```bash
npm test                      # state.js 단위 테스트
node --check src/<file>.js    # 문법 체크 (import 경고는 무시 — Chrome이 모듈로 로드)
```

확장 로드: `chrome://extensions` → 개발자 모드 → "압축해제된 확장 로드" → 이 폴더.
배포 zip: `Compress-Archive -Path manifest.json, src, icons -DestinationPath shorts-blocker-v0.2.zip -Force`

> **중요 규칙**: 코드 수정 후엔 **① 확장 새로고침(chrome://extensions) + ② 열려있는 YouTube 탭 Ctrl+R** 를 반드시 같이 해야 반영됨. 안 그러면 낡은 content script가 분리(orphaned)돼 tick이 조용히 실패함.

## 아키텍처

- `src/lib/state.js` — **순수 로직(진실의 원천)**. 부수효과 없음, 시계를 인자로 받음. `applyTick`, `addBonus`, `applyOff`, `turnOn`, `setLimit`, `isOffActive`, `effectiveLimitMs`, `resetDay`, `defaultSettings`.
- `src/background.js` — 서비스워커. `chrome.storage.local` I/O, 직렬화 큐(`serialize`)로 race 방지, `chrome.alarms`(자정 리셋 `daily-reset`, Off 만료 `off-expire`), 메시지 라우팅, 한도 초과 시 쇼츠 탭에 `block` 브로드캐스트, v0.1→v0.2 마이그레이션.
- `src/content.js` — 모든 youtube.com 페이지에 주입.
  - **① 마스트헤드 ON/OFF 토글** (`#sb-toggle`): `ytd-masthead #end`에 삽입, SPA 이동 대비 1초마다 재삽입. ON=초록/OFF=빨강. 클릭 시 `turnOn`/`setOff`.
  - **② 온비디오 카운터** (`#sb-counter`): `/shorts/`에서만 표시. body에 `position:fixed`로 붙이고, **활성 영상(`<video>` 중 가장 큰 것)의 `getBoundingClientRect`를 0.3초마다 읽어 영상 우측 바깥·세로 중앙에 위치 추적**(댓글/사이드바 열려 영상이 밀려도 따라감). 세로 스택 칩: `● 오늘 쇼츠 시청` / 경과시간(한도 숫자는 표시 안 함). 점 색=한도 임박도(초록/앰버/빨강).
  - **③** `/shorts/` + visible일 때 1초마다 `tick` 전송. **④** `block` 수신 시 차단 페이지로 리다이렉트. **⑤** Off/hideShorts에 따라 `html.shorts-blocker-nohide` 토글.
  - 상태는 `chrome.storage.local`에서 캐시(`cachedState`/`cachedSettings`), `storage.onChanged`로 갱신 → 카운터가 탭 간 실시간 동기화.
- `src/content.css` — 쇼츠 UI 숨김 셀렉터(`html:not(.shorts-blocker-nohide)`로 게이팅) + `#sb-toggle`(테마 적응) + `#sb-counter`(코랄 테두리 세로 칩) 스타일.
- `src/blocked.{html,css,js}` — 차단 페이지. 브랜드 로크업(로고+워드마크), "오늘 쇼츠는 그만 🛑", 자정 카운트다운, "10분 더 보기" → 30초 대기카드("잠깐만요 ☕" + "오늘 쇼츠, 얼마나 봤어?" + 사용량) + 2번 확인 → bypass.
- `src/popup.{html,css,js}` — 툴바 팝업. 로고+워드마크+태그라인 헤더, 포커스 링(사용량/유효한도), 한도 프리셋 칩+스테퍼, ON/OFF 스위치, 피드숨김 토글, **피드백 구글폼 링크**(`FEEDBACK_URL` 상수, popup.js 상단). 1초 폴링. 메인 OFF 시 피드숨김 토글 흐려짐.

## 데이터 모델 (`chrome.storage.local`)

```js
state    = { todayUsageMs, bonusMs, todayDateKey }   // 자정 리셋
settings = { dailyLimitMs, offUntil, hideShorts }    // 영속
```

핵심 동작:
- **유효 한도** = `dailyLimitMs + bonusMs`. 사용량이 유효 한도 도달 시 차단.
- **Off**: `offUntil`(epoch) 설정. **1시간 고정**, 만료 시 자동 ON. Off 중에도 **카운트는 계속**(정직성), 차단·숨김만 해제.
- **"10분 더 보기"** = `addBonus`: 유효 한도를 **현재 사용량 + 10분**으로 올림(한도+10이 아님). Off 오버런 후에도 항상 진짜 10분 확보. 단조 증가.
- **bypassUntil 개념은 제거됨**(bonusMs 모델로 대체).

## 브랜드

- 시그니처 컬러 **코랄 `#ff6b5c`** (로고 글로우·워드마크·태그라인·팝업 활성칩 등 브랜드 크롬용)
- 상태색은 기능 전용: 초록(여유) `#5ee08a` / 앰버(임박·Off) `#ffb15c` / 빨강(초과) `#ff5563`
- 다크 베이스 `#141414`/`#1f1f1f`. 로고 = 빨간 깨진 쇼츠 아이콘(`icons/`, 흰 배경이라 둥근 타일로 표시)
- 노출 접점: ① 마스트헤드 토글 ② 온비디오 카운터 ③ 팝업 ④ 차단 페이지

## 배포 (남은 일)

- 코드/아이콘/zip/GitHub Pages(privacy) 준비 완료. 가이드: `docs/store-listing.md`
- **피드백 창구**: 팝업의 구글폼 링크(연결 완료) + GitHub Issues + 이메일(dhkd3213@gmail.com). 바이럴/공유 기능은 v1.1로 보류.
- **남은 것**: 스크린샷 5장(1280×800) 촬영 + 웹스토어 대시보드 제출($5 개발자 등록). privacy URL: `https://dhkd3213.github.io/shorts-blocker/docs/privacy.html`
- ⚠️ 아이콘이 공식 쇼츠 로고와 유사 → 트레이드마크 리젝 리스크 감수하기로 함(사용자 결정). 리젝 시 오리지널 디자인으로 교체.

## 기획 문서

- 스펙: `docs/superpowers/specs/` (v0.1, v0.2 디자인)
- 플랜: `docs/superpowers/plans/`
