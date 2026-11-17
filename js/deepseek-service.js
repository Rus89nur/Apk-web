/**
 * Клиент DeepSeek через публичный прокси (без API-ключа).
 * Ошибки сети/таймаута не пробрасываются в UI — возвращают null/[].
 */
const DeepseekService = (() => {
  function cfg() {
    return typeof DeepseekConfig !== 'undefined' ? DeepseekConfig : {};
  }

  function isAvailable() {
    const c = cfg();
    if (c.ENABLED === false) return false;
    if (!String(c.PROXY_URL || '').trim()) return false;
    if (typeof GazpromOffline !== 'undefined' && GazpromOffline.isOffline()) return false;
    return true;
  }

  function proxyChatUrl() {
    const base = String(cfg().PROXY_URL || '').replace(/\/+$/, '');
    return base ? `${base}/v1/chat` : '';
  }

  /**
   * Устойчивый разбор JSON из ответа модели (markdown fences, обрезки).
   * @param {string} text
   * @returns {object|null}
   */
  function parseModelJson(text) {
    if (text == null) return null;
    let raw = String(text).trim();
    if (!raw) return null;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function extractMessageContent(data) {
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    if (!msg) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((part) => (typeof part === 'string' ? part : part?.text || ''))
        .join('');
    }
    return '';
  }

  /**
   * @param {Array} messages
   * @param {{ signal?: AbortSignal, response_format?: object, temperature?: number, max_tokens?: number }} [opts]
   * @returns {Promise<object|null>}
   */
  async function chat(messages, opts = {}) {
    if (!isAvailable()) return null;
    const url = proxyChatUrl();
    if (!url) return null;

    const timeoutMs = Number(cfg().TIMEOUT_MS) || 25000;
    const controller = new AbortController();
    const outer = opts.signal;
    const onAbort = () => controller.abort();
    if (outer) {
      if (outer.aborted) {
        controller.abort();
      } else {
        outer.addEventListener('abort', onAbort, { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = {
        model: cfg().MODEL || 'deepseek-flash',
        messages,
        stream: false,
        thinking: { type: 'disabled' },
        reasoning_effort: 'none',
      };
      if (opts.response_format) body.response_format = opts.response_format;
      if (opts.temperature != null) body.temperature = opts.temperature;
      if (opts.max_tokens != null) body.max_tokens = opts.max_tokens;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Сжатие data URL: JPEG, длинная сторона ≤ maxSide.
   * @param {string} dataUrl
   * @param {number} [maxSide=1024]
   * @returns {Promise<string>}
   */
  async function compressImageDataUrl(dataUrl, maxSide = 1024) {
    if (!dataUrl || typeof dataUrl !== 'string') return '';
    if (typeof document === 'undefined') return dataUrl;
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image load'));
        el.src = dataUrl;
      });
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (!w || !h) return dataUrl;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0, tw, th);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return dataUrl;
    }
  }

  /**
   * @param {{ titleHint?: string, mesto?: string, vid?: string, existingTitles?: string[] }} input
   * @returns {Promise<{ title: string, formulaFromRules?: string, urlToPravilo?: string, vid?: string }|null>}
   */
  async function suggestFormulation(input = {}) {
    if (!isAvailable()) return null;
    const titles = (input.existingTitles || [])
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .slice(0, 60);
    const system = [
      'Ты помощник инженера по промышленной безопасности (ПБ) ГАЗПРОМ.',
      'Формулируй нарушения в стиле актов проверки: кратко, официально, по-русски.',
      'Ответь строго JSON-объектом без markdown.',
      'Поля: title (обязательно), formulaFromRules, urlToPravilo, vid — строки.',
      'Не выдумывай номера пунктов правил без оснований; urlToPravilo можно оставить пустым.',
    ].join(' ');
    const user = [
      `Место: ${input.mesto || '—'}`,
      `Вид нарушения: ${input.vid || '—'}`,
      `Подсказка / черновик: ${input.titleHint || '—'}`,
      titles.length
        ? `Примеры формулировок из реестра (ориентир стиля):\n- ${titles.join('\n- ')}`
        : 'Реестр пуст — предложи типовую формулировку ПБ.',
      'Верни JSON: {"title":"...","formulaFromRules":"...","urlToPravilo":"...","vid":"..."}',
    ].join('\n');

    const data = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { response_format: { type: 'json_object' }, temperature: 0.3, max_tokens: 800 }
    );
    if (!data) return null;
    const parsed = parseModelJson(extractMessageContent(data));
    if (!parsed) return null;
    const title = String(parsed.title || '').trim();
    if (!title) return null;
    return {
      title,
      formulaFromRules: String(parsed.formulaFromRules || '').trim() || undefined,
      urlToPravilo: String(parsed.urlToPravilo || '').trim() || undefined,
      vid: String(parsed.vid || '').trim() || undefined,
    };
  }

  /**
   * @param {{ dataUrl: string, registryTitles?: string[], items?: Array<{title?: string, vid?: string}> }} input
   * @returns {Promise<Array<{ title: string, confidence: number, vid?: string }>>}
   */
  async function matchByPhoto(input = {}) {
    if (!isAvailable()) return [];
    const dataUrl = input.dataUrl;
    if (!dataUrl) return [];

    const fromItems = (input.items || [])
      .map((it) => String(it?.title || '').trim())
      .filter(Boolean);
    const titles = (input.registryTitles || fromItems)
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .slice(0, 80);
    if (!titles.length) return [];

    const imageUrl = await compressImageDataUrl(dataUrl, 1024);
    if (!imageUrl) return [];

    const system = [
      'Ты помощник по промышленной безопасности. По фото выбери ближайшие формулировки нарушений из списка.',
      'Ответь строго JSON без markdown: {"candidates":[{"title":"...","confidence":0.0,"vid":"..."}]}',
      '1–4 кандидата. confidence от 0 до 1. title — точная строка из списка или новая краткая формулировка.',
      'Если ничего не подходит — candidates: [].',
    ].join(' ');
    const userText = `Список формулировок реестра:\n- ${titles.join('\n- ')}\n\nВыбери 1–4 ближайших по фото.`;

    const data = await chat(
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
          ],
        },
      ],
      { response_format: { type: 'json_object' }, temperature: 0.2, max_tokens: 600 }
    );
    if (!data) return [];
    const parsed = parseModelJson(extractMessageContent(data));
    const list = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const out = [];
    for (const row of list) {
      const title = String(row?.title || '').trim();
      if (!title) continue;
      let confidence = Number(row?.confidence);
      if (!Number.isFinite(confidence)) confidence = 0.5;
      confidence = Math.max(0, Math.min(1, confidence));
      const vid = String(row?.vid || '').trim();
      out.push(vid ? { title, confidence, vid } : { title, confidence });
      if (out.length >= 4) break;
    }
    return out;
  }

  return {
    isAvailable,
    chat,
    suggestFormulation,
    matchByPhoto,
    parseModelJson,
    compressImageDataUrl,
  };
})();
