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
