# АПК — веб-приложение

Браузерная PWA «программа НЕТ» (акты проверок). Репозиторий содержит **только веб**.

- Локально: `~/Desktop/Apk-web`
- GitHub: [Rus89nur/program](https://github.com/Rus89nur/program)
- Сайт: https://rus89nur.github.io/program/

iOS-приложение — отдельная папка и репозиторий `program-ios`.

## Запуск

**Вариант 1** — двойной клик по `start_server.command`, затем:

http://localhost:3000/

**Вариант 2:**

```bash
python3 dev-server.py
```

После изменения файлов обновите страницу (Cmd+R).

## Тесты

```bash
npm install
npm test
```

Чеклист: [`QA_WEB.md`](QA_WEB.md). Телефонный режим: [`MOBILE_PHONE_MODE.md`](MOBILE_PHONE_MODE.md). Деплой: [`DEPLOY.md`](DEPLOY.md).
