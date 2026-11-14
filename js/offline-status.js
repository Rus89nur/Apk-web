/**
 * Офлайн UX и мягкая очередь сетевых side-effects (seed пресетов, build-check, SW).
 * Каталог актов/фото НЕ ставится в очередь — он уже в IndexedDB (local-only).
 * «Сохранение после интернета» = данные уже на устройстве; сеть нужна для shell/пресетов.
 */
const GazpromOffline = (() => {
  const PENDING_KEYS = ['defaultsSeed', 'buildCheck', 'swUpdate'];
  const pending = {
    defaultsSeed: false,
    buildCheck: false,
    swUpdate: false,
  };

  function isOffline(nav = typeof navigator !== 'undefined' ? navigator : null) {
    if (!nav) return false;
    return nav.onLine === false;
  }

  /**
   * Подписи для #headerSyncBtn — без обещания облачной синхронизации.
   */
  function headerLabel({ offline = false, busy = false } = {}) {
    if (busy) {
      return { status: 'Обновление…', timeMode: 'keep', offline: false };
    }
    if (offline) {
      return {
        status: 'Офлайн · данные на этом устройстве',
        timeMode: 'hide',
        offline: true,
      };
    }
    return {
      status: 'Локально сохранено',
      timeMode: 'show',
      offline: false,
    };
  }

  function markPending(key) {
    if (!PENDING_KEYS.includes(key)) return false;
    pending[key] = true;
    return true;
  }

  function clearPending(key) {
    if (!PENDING_KEYS.includes(key)) return false;
    pending[key] = false;
    return true;
  }

  function getPending() {
    return { ...pending };
  }

  function hasPending() {
    return PENDING_KEYS.some((k) => pending[k]);
  }

  /**
   * Один проход: только помеченные side-effects. Каталог сюда не передавать.
   * @param {Record<string, () => Promise<unknown>>} handlers
   */
  async function flushPending(handlers = {}) {
    const results = {};
    for (const key of PENDING_KEYS) {
      if (!pending[key]) continue;
      const fn = handlers[key];
      if (typeof fn !== 'function') continue;
      try {
        await fn();
        pending[key] = false;
        results[key] = 'ok';
      } catch (err) {
        results[key] = 'fail';
        console.warn('[GazpromOffline] flush', key, err);
      }
    }
    return results;
  }

  function applyDocumentClass(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc?.body) return;
    doc.body.classList.toggle('gazprom-offline', isOffline());
  }

  return {
    PENDING_KEYS,
    isOffline,
    headerLabel,
    markPending,
    clearPending,
    getPending,
    hasPending,
    flushPending,
    applyDocumentClass,
  };
})();
