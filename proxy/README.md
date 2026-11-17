# DeepSeek proxy (Cloudflare Worker)

Прокси скрывает `DEEPSEEK_API_KEY` от клиента PWA на GitHub Pages.

## Эндпоинт

- `POST /v1/chat` → `https://api.deepseek.com/chat/completions`
- CORS: `https://rus89nur.github.io`, localhost (3000/8080)
- Ключ только из secret Worker (`env.DEEPSEEK_API_KEY`)

## Деплой

```bash
cd proxy
npx wrangler deploy deepseek-worker.js --name apk-gi-deepseek-proxy
npx wrangler secret put DEEPSEEK_API_KEY --name apk-gi-deepseek-proxy
```

После деплоя скопируйте URL Worker (например `https://apk-gi-deepseek-proxy.<account>.workers.dev`) в клиент:

`js/deepseek-config.js` → `PROXY_URL: 'https://…workers.dev'`

(без завершающего `/`; клиент вызывает `PROXY_URL + '/v1/chat'`).

Пока `PROXY_URL` пуст — кнопки ИИ в модалке нарушения отключены («ИИ не настроен»), офлайн и локальный ML продолжают работать.

## Важно

- Не кладите ключ в `index.html`, клиентский JS, Actions artifact Pages или git.
- Не коммитьте `.dev.vars` / `.env` с ключом.
- Worker не логирует `Authorization` и не пишет полные тела с base64.
