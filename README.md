# Niche Outreach Daily (GitHub Pages)

정적 웹 버전. **Python 없음.** 상태는 브라우저 `localStorage`.

## 로컬 미리보기

```bash
# pages 폴더에서
python -m http.server 8767
```

열기: http://127.0.0.1:8767/

> `file://` 로 직접 열면 `accounts.json` fetch가 막힐 수 있음 → 간단 서버 권장.

## GitHub Pages 배포

### 옵션 A — 이 폴더만 레포로

1. 새 레포 예: `niche-outreach-daily`
2. `pages/` 안 내용을 레포 **루트**에 푸시  
   (`index.html`, `app.js`, `styles.css`, `data/`, `.nojekyll`)
3. Settings → Pages → Deploy from branch → `main` / root
4. URL: `https://<user>.github.io/niche-outreach-daily/`

### 옵션 B — 기존 username.github.io 레포

1. `username.github.io` 레포에 폴더 추가  
   예: `niche-outreach/`
2. `pages/*` 를 그 폴더에 복사 후 푸시
3. URL: `https://<user>.github.io/niche-outreach/`

### 옵션 C — project site (docs/)

레포 루트에 이 프로젝트가 있으면:

- `pages/` 를 `docs/` 로 복사하거나
- Pages source = `/docs`

## 원격 팩 URL

배포 후 팩 JSON을 raw로 올리면:

```
https://you.github.io/niche-outreach/?pack=https://you.github.io/niche-outreach/packs/kr-ai.json
```

(상대 경로 pack은 동일 오리진일 때 안전)

## 로컬 Python 버전

상위 폴더 `run.bat` / `server.py` — 파일 기반 저장.

## 라이선스

MIT (상위 LICENSE)
