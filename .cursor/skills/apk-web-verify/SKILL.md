---
name: apk-web-verify
description: >-
  Checks the АПК_ГИ web PWA locally and before deploy. Use in verifier after
  implementer, before commit/push, or when the user asks to test, QA, or
  bump cache (sw.js, web-N, ?v=).
---

# Проверка АПК_ГИ

- Тесты: `npm test` (vitest) в корне репозитория.
- Локально: `python3 dev-server.py` → http://localhost:3000/ (не `file://`).
- После правок HTML/CSS/JS: bump `CACHE_NAME` в `sw.js`, `web-N` в `index.html` (`data-app-build` и `#appBuildId`), `?v=` у изменённых CSS/JS и `sw.js?v=` в `app.js`.
- Акты в IndexedDB не в git. Не чистить данные сайта без запроса.
- Сайт: https://rus89nur.github.io/Apk-web/ только после push в `main`.
- Чеклист приёмки: `QA_WEB.md`.
