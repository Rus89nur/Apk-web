/** Стиль оформления: классический или день/ночь по системной теме. */
const GazpromAppearance = (() => {
  const KEY = 'gazprom-appearance';

  function resolveAppearance(stored, prefersDark) {
    const mode = stored === 'system' ? 'system' : 'classic';
    const scheme = prefersDark ? 'dark' : 'light';
    return { mode, scheme };
  }

  function readStored() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  function prefersDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function themeColor(mode, scheme) {
    if (mode !== 'system') return '#0d47a1';
    return scheme === 'dark' ? '#0c1018' : '#e7eef6';
  }

  function paint(mode, scheme) {
    const root = document.documentElement;
    root.dataset.appearance = mode;
    root.dataset.scheme = scheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColor(mode, scheme));
    const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (apple) apple.setAttribute('content', mode === 'system' && scheme === 'dark' ? 'black' : 'default');
    document.querySelectorAll('[data-appearance-choice]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.appearanceChoice === mode ? 'true' : 'false');
    });
  }

  function applyFromStorage() {
    const { mode, scheme } = resolveAppearance(readStored(), prefersDark());
    paint(mode, scheme);
    return { mode, scheme };
  }

  function setMode(mode) {
    const next = mode === 'system' ? 'system' : 'classic';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
    applyFromStorage();
  }

  function bind() {
    applyFromStorage();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      if (readStored() === 'system') applyFromStorage();
    };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else mq.addListener(onScheme);
    document.querySelectorAll('[data-appearance-choice]').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.appearanceChoice));
    });
  }

  return { resolveAppearance, bind, setMode, applyFromStorage };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => GazpromAppearance.bind());
} else {
  GazpromAppearance.bind();
}
