/**
 * Публичная конфигурация DeepSeek (без API-ключа).
 * PROXY_URL — URL Cloudflare Worker без завершающего «/».
 * Пока пуст — ИИ-функции тихо отключены.
 */
const DeepseekConfig = Object.freeze({
  /** @type {string} */
  PROXY_URL: '',
  MODEL: 'deepseek-flash',
  TIMEOUT_MS: 25000,
  /** false — скрыть кнопку «Сформулировать (ИИ)» */
  ENABLED: true,
});
