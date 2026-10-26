# 보고바이오 입점채널 현황판

GitHub Pages로 배포되는 정적 대시보드입니다. `index.html` 하나로 동작하며, 데이터는 AES-256-GCM으로 암호화되어 비밀번호 없이는 열람할 수 없습니다.

## 구조
- `index.html` — 배포되는 대시보드(암호화된 데이터 포함)
- `build/dash_template.html` — 원본 템플릿 (`/*__ENC__*/` 자리에 암호문이 들어감)
- `build/encrypt.js` — 데이터 암호화 + 페이지 생성 스크립트
- `data/data.json` — 원장에서 내보낸 데이터(평문, 민감하면 커밋하지 말 것)

## 다시 만들기
```
cd build && node encrypt.js ../data/data.json ../index.html '비밀번호'
```

## 구글 시트 연동 (2단계)
- `apps-script/Code.gs` — 구글 시트에 붙여넣는 자동화 코드(폼 생성·원장 누적·데이터 API·텔레그램)
- `apps-script/SETUP.md` — 설치 가이드
- 연동 후 빌드: `cd build && node encrypt.js ../data/data.json ../index.html '비밀번호' '웹앱URL'` (웹앱URL을 넣으면 페이지가 시트에서 데이터를 받아옴)
