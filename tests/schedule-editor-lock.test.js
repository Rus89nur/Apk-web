import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const src = readFileSync(join(rootDir, 'js/schedule-editor.js'), 'utf8');

function yearGridSrc() {
  return src.slice(src.indexOf('function showYearGrid'), src.indexOf('function showMonthDetail'));
}

function monthDetailSrc() {
  return src.slice(src.indexOf('function showMonthDetail'), src.indexOf('function findObject'));
}

function camelDataKey(name) {
  return name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function hasClass(el, name) {
  return ` ${el.className || ''} `.includes(` ${name} `);
}

function matches(el, rawSel) {
  const sel = String(rawSel).trim();
  if (!sel) return false;
  if (sel.startsWith('.')) {
    return sel.slice(1).split('.').every((cls) => hasClass(el, cls));
  }
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('[') && sel.endsWith(']')) {
    const body = sel.slice(1, -1);
    const eq = body.indexOf('=');
    if (eq < 0) {
      if (body.startsWith('data-')) {
        return el.dataset[camelDataKey(body.slice(5))] != null;
      }
      return el.getAttribute(body) != null;
    }
    const attr = body.slice(0, eq).trim();
    const val = body.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (attr.startsWith('data-')) {
      return String(el.dataset[camelDataKey(attr.slice(5))] ?? '') === val;
    }
    return el.getAttribute(attr) === val;
  }
  return el.tagName === sel.toUpperCase();
}

function queryAll(node, selector) {
  const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  function walk(current) {
    for (const child of current.children || []) {
      if (parts.some((part) => matches(child, part)) && !seen.has(child)) {
        seen.add(child);
        out.push(child);
      }
      walk(child);
    }
  }
  walk(node);
  return out;
}

function parseAttrs(el, attrStr) {
  const re = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(attrStr))) {
    el.setAttribute(m[1], m[2] ?? '');
  }
}

function createEl(tag = 'div') {
  const listeners = {};
  const attrs = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    id: '',
    className: '',
    dataset: {},
    hidden: false,
    parentNode: null,
    isConnected: false,
    textContent: '',
    value: '',
    style: {},
    classList: {
      contains: (name) => hasClass(el, name),
      add(name) {
        if (!hasClass(el, name)) el.className = `${el.className} ${name}`.trim();
      },
      remove(name) {
        el.className = String(el.className || '')
          .split(/\s+/)
          .filter((c) => c && c !== name)
          .join(' ');
      },
    },
    setAttribute(name, val) {
      const value = val == null ? '' : String(val);
      attrs[name] = value;
      if (name === 'id') el.id = value;
      if (name === 'class') el.className = value;
      if (name === 'hidden') el.hidden = true;
      if (name.startsWith('data-')) {
        el.dataset[camelDataKey(name.slice(5))] = value;
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    appendChild(child) {
      child.parentNode = el;
      child.isConnected = true;
      el.children.push(child);
      return child;
    },
    remove() {
      if (el.parentNode) {
        el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
        el.parentNode = null;
      }
      el.isConnected = false;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    click() {
      const evt = { type: 'click', target: el, preventDefault() {}, key: '' };
      (listeners.click || []).forEach((fn) => fn(evt));
    },
    focus() {},
    querySelector(sel) {
      return queryAll(el, sel)[0] || null;
    },
    querySelectorAll(sel) {
      return queryAll(el, sel);
    },
  };

  Object.defineProperty(el, 'onclick', {
    set(fn) {
      el.addEventListener('click', fn);
    },
  });

  Object.defineProperty(el, 'innerHTML', {
    get() {
      return el._html || '';
    },
    set(html) {
      el._html = String(html);
      el.children = [];
      const tagRe = /<([a-zA-Z0-9]+)([^>]*)>/g;
      let m;
      while ((m = tagRe.exec(el._html))) {
        const child = createEl(m[1]);
        parseAttrs(child, m[2]);
        el.appendChild(child);
      }
    },
  });

  return el;
}

function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function sampleCatalog() {
  const year = new Date().getFullYear();
  return {
    organizations: [{ id: 'org1', title: 'ООО Тест' }],
    objects: [{ id: 'obj1', title: 'КС', subTitle: 'Адрес' }],
    scheduleItems: [{
      id: 's1',
      scheduledDate: `${year}-01-15T12:00:00.000Z`,
      year,
      month: 1,
      objectCheck: { id: 'obj1', title: 'КС', subTitle: 'Адрес' },
    }],
  };
}

function loadEditor() {
  const overlayState = { lockCount: 0, unlockCount: 0, recoverCount: 0 };
  const body = createEl('body');
  body.isConnected = true;
  const docListeners = {};
  const document = {
    body,
    getElementById(id) {
      return findById(body, id);
    },
    createElement: createEl,
    querySelector(sel) {
      return queryAll(body, sel)[0] || null;
    },
    querySelectorAll(sel) {
      return queryAll(body, sel);
    },
    addEventListener(type, fn) {
      (docListeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn);
    },
  };

  const catalog = sampleCatalog();
  const ctx = {
    console,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Array,
    Promise,
    parseInt,
    String,
    Number,
    Boolean,
    setTimeout,
    clearTimeout,
    document,
    GazpromMobileOverlay: {
      lock() { overlayState.lockCount += 1; },
      unlock() { overlayState.unlockCount += 1; },
      scheduleRecoverViewportLayout() { overlayState.recoverCount += 1; },
    },
    GazpromStore: {
      get: async () => catalog,
      hasData: () => true,
      set: async () => {},
      invalidateCache() {},
    },
    GazpromToast: { error() {}, success() {}, confirm: async () => true },
    GazpromUI: { refreshAll: async () => {} },
    AktUtils: {
      escapeHtml: (s) => String(s ?? ''),
      formatDateShort: () => '15.01',
      toDateInputValue: () => `${new Date().getFullYear()}-01-15`,
      uuid: () => 'new-id',
      formatObjectDisplay: (o) => o?.title || '',
      formatObjectHtml: (o) => String(o?.title || ''),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nthis.ScheduleEditor = ScheduleEditor;`, ctx);
  return {
    ctx,
    overlayState,
    document,
    fireKey(key) {
      (docListeners.keydown || []).forEach((fn) => fn({ key }));
    },
    root() {
      return document.getElementById('scheduleEditorRoot');
    },
  };
}

describe('schedule-editor overlay lock', () => {
  it('showYearGrid лочит только если редактор ещё не открыт', () => {
    const yearSrc = yearGridSrc();
    expect(yearSrc).toContain('alreadyOpen');
    expect(yearSrc).toMatch(/if\s*\(\s*!alreadyOpen\s*\)\s*GazpromMobileOverlay\.lock\(\)/);
    expect(yearSrc).not.toMatch(/root\.hidden\s*=\s*false;\s*GazpromMobileOverlay\.lock\(\)/);
  });

  it('showMonthDetail не вызывает lock, close восстанавливает viewport', () => {
    expect(monthDetailSrc()).not.toContain('GazpromMobileOverlay.lock(');
    expect(src).toContain('scheduleRecoverViewportLayout');
    expect(src).toContain('const wasOpen = root && !root.hidden');
    expect(src).toMatch(/if\s*\(\s*wasOpen\s*\)\s*GazpromMobileOverlay\.unlock\(\)/);
  });

  it('open → смена года → close балансирует lock/unlock', async () => {
    const { ctx, overlayState, root } = loadEditor();
    ctx.ScheduleEditor.open();
    await flush();
    expect(overlayState.lockCount).toBe(1);
    expect(root().hidden).toBe(false);

    root().querySelector('[data-year-next]').click();
    expect(overlayState.lockCount).toBe(1);

    root().querySelector('[data-year-prev]').click();
    expect(overlayState.lockCount).toBe(1);

    root().querySelector('[data-close]').click();
    expect(root().hidden).toBe(true);
    expect(overlayState.unlockCount).toBe(overlayState.lockCount);
    expect(overlayState.recoverCount).toBeGreaterThan(0);
  });

  it('месяц → «← Год» → close не оставляет leftover lock', async () => {
    const { ctx, overlayState, root } = loadEditor();
    ctx.ScheduleEditor.open();
    await flush();

    root().querySelector('.schedule-month-cell').click();
    expect(overlayState.lockCount).toBe(1);
    expect(root().querySelector('[data-back]')).toBeTruthy();

    root().querySelector('[data-back]').click();
    await flush();
    expect(overlayState.lockCount).toBe(1);
    expect(root().querySelector('[data-year-next]')).toBeTruthy();

    root().querySelector('[data-close]').click();
    expect(root().hidden).toBe(true);
    expect(overlayState.lockCount).toBe(overlayState.unlockCount);
  });

  it('закрытие из месяца и повторный close идемпотентны', async () => {
    const { ctx, overlayState, root, fireKey } = loadEditor();
    ctx.ScheduleEditor.open();
    await flush();
    root().querySelector('.schedule-month-cell').click();
    root().querySelector('[data-close]').click();

    expect(root().hidden).toBe(true);
    expect(overlayState.lockCount).toBe(1);
    expect(overlayState.unlockCount).toBe(1);

    fireKey('Escape');
    root().querySelector('[data-close]')?.click();
    expect(overlayState.unlockCount).toBe(1);
  });

  it('picker Отмена + close графика снимает вложенный lock', async () => {
    const { ctx, overlayState, document, root } = loadEditor();
    ctx.ScheduleEditor.open();
    await flush();
    root().querySelector('.schedule-month-cell').click();
    root().querySelector('[data-add]').click();
    await flush();

    expect(overlayState.lockCount).toBe(2);
    document.querySelector('[data-cancel]').click();
    expect(overlayState.unlockCount).toBe(1);

    root().querySelector('[data-close]').click();
    expect(root().hidden).toBe(true);
    expect(overlayState.lockCount).toBe(overlayState.unlockCount);
    expect(document.querySelector('.schedule-form-overlay')).toBeNull();
  });
});
