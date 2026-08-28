# Деплой веб-приложения АПК_ГИ

## Локальный запуск

```bash
python3 -m http.server 8080
# или: ./start_server.command
```

Откройте http://localhost:8080/

> PWA и Service Worker работают только по `http://` (не `file://`).

## GitHub Pages

Workflow: [`.github/workflows/deploy-gazprom-web.yml`](.github/workflows/deploy-gazprom-web.yml)

1. В репозитории: Settings → Pages → Source: **GitHub Actions**
2. Push в `main`
3. URL: `https://rus89nur.github.io/Apk-web/`

После деплоя проверьте: HTTPS, установка PWA, офлайн-статика (SW v29), экспорт Excel/Word из `assets/vendor/`.

## nginx (продакшен)

```nginx
server {
    listen 80;
    server_name akty.example.local;
    root /var/www/gazprom-web;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|json|gazprombackup)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

Скопируйте содержимое репозитория в `root`.

## Тесты

```bash
npm install
npm test
```
