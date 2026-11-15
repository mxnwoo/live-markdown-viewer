# Live Markdown

한 페이지에서 쓰고, 미리 보고, 링크로 공유하는 작은 마크다운 편집기.

- **편집 링크:** 편집기 + 미리보기, 자동 저장, 보기·편집 링크 공유
- **보기 링크:** 문서만 표시. 서버에서도 수정과 편집 링크 발급을 거부
- **라이브 공유:** 약 1.5초마다 최신 문서를 확인 (백그라운드 탭은 일시 중단)
- **충돌 보호:** 동시 수정은 덮어쓰지 않고 최신 내용과 내 내용 중 선택. 문자 단위 동시 병합은 지원하지 않음
- 모바일에서는 편집기와 미리보기가 위아래로 배치
- Markdown GFM, 표, 코드 블록, 다운로드. HTML은 DOMPurify로 정리
- 계정 없이 링크 자체로 권한 부여. 링크를 전달받은 사람도 같은 권한을 가짐

## 구조

화면은 **GitHub Pages**, 저장·권한 검증은 **Cloudflare Worker + Durable Objects**에서 처리합니다. GitHub Pages는 정적 호스팅이므로 서버를 함께 연결해야 라이브 공유가 됩니다.

서버 URL이 없는 상태에서도 브라우저 임시 저장과 미리보기는 사용할 수 있지만, 공유는 사용할 수 없습니다.

## 로컬 실행

Node.js 22 이상:

```sh
npm ci
cp .env.example .env.local
npm run server:dev
```

다른 터미널:

```sh
npm run dev
```

`http://127.0.0.1:5173`에서 엽니다. 서버가 실행 중일 때 `npm test`로 실제 API의 권한, 동시 수정, 크기 제한을 검증합니다.

## 배포

이 저장소에는 배포된 API 주소가 `src/config.js`에 연결되어 있습니다. 현재 프로젝트는 **Settings → Pages → Source → GitHub Actions**만 선택하면 됩니다. 이후 `main`의 변경사항은 자동 배포됩니다. 첫 실행이 실패했다면 Actions에서 다시 실행하세요.

다른 Cloudflare 계정으로 서버를 옮기는 경우:

1. `npx wrangler login`으로 Cloudflare에 로그인합니다.
2. `npm run server:deploy`를 실행합니다. Durable Objects 저장소도 생성됩니다.
3. `src/config.js`의 `apiUrl`을 배포된 Worker URL로 변경합니다. 또는 GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**에서 `VITE_API_URL`을 지정합니다 (마지막 `/` 제외).
4. **Settings → Pages → Source → GitHub Actions**를 선택합니다.
5. `main`에 push하거나 **Actions → Deploy GitHub Pages → Run workflow**를 실행합니다.

`.github/workflows/pages.yml`이 빌드와 Pages 배포를 처리합니다. Vite는 상대 경로를 사용하므로 `/live-markdown-viewer/` 하위 경로에서도 동작합니다.

다른 Pages 계정이나 커스텀 도메인을 사용하면 `wrangler.jsonc`의 `ALLOWED_ORIGINS`도 변경하고 서버를 다시 배포하세요. 경로가 아닌 출처(예: `https://example.com`)를 지정합니다.

## 링크와 저장

- `#doc=문서ID&key=권한키` 형태. URL 조각에 포함된 키는 Pages 서버에 전송되지 않습니다. API 요청에는 Authorization 헤더로 전달합니다.
- 보기 키와 편집 키는 별도의 난수(256비트)입니다. 보기 링크를 편집 링크로 바꿀 수 없습니다.
- 편집자는 보기·편집 링크를 발급할 수 있습니다. 발급할 때마다 같은 권한의 링크를 재사용합니다.
- 간단한 공유를 위한 앱으로, 사용자별 권한·링크 만료·개별 링크 회수·문서 삭제 기능은 없습니다. 편집 링크를 잃어버리면 복구할 수 없으므로 보관하세요.
- 새 문서는 공유할 때 서버에 생성되며, 이후 자동 저장됩니다. 공유 전 내용은 현재 브라우저에만 임시 저장됩니다.
- 저장 실패·동시 수정 시 작성 내용은 현재 브라우저에 임시 저장합니다. `최신 내용 불러오기`를 선택하면 직전 내 내용은 해당 브라우저의 localStorage `lmv:draft:…:backup`에 남습니다.
- 본문 최대 100KB(UTF-8), 제목 최대 120자입니다.
- 파일 첨부·이미지 업로드·변경 이력은 없습니다. 외부 이미지 URL은 사용할 수 있습니다.
- 익명 생성이 허용됩니다. 공개 배포를 크게 운영할 때는 Cloudflare에서 생성 요청 제한을 별도로 설정하세요. 사용량에 따라 Cloudflare 비용이 발생할 수 있습니다.

기술 참고: [GitHub Pages 배포](https://vite.dev/guide/static-deploy.html#github-pages), [Durable Objects 저장소](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

