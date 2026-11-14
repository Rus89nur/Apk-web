import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeEach } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadOffline() {
  const ctx = { console, Object };
  vm.createContext(ctx);
  const code =
    readFileSync(join(root, 'js/offline-status.js'), 'utf8') +
    '\nif (typeof GazpromOffline !== "undefined") this.GazpromOffline = GazpromOffline;\n';
  vm.runInContext(code, ctx);
  return ctx.GazpromOffline;
}

describe('GazpromOffline', () => {
  let GazpromOffline;

  beforeEach(() => {
    GazpromOffline = loadOffline();
  });

  it('isOffline reflects navigator.onLine', () => {
    expect(GazpromOffline.isOffline({ onLine: true })).toBe(false);
    expect(GazpromOffline.isOffline({ onLine: false })).toBe(true);
    expect(GazpromOffline.isOffline(null)).toBe(false);
  });

  it('headerLabel offline / online / busy', () => {
    expect(GazpromOffline.headerLabel({ busy: true }).status).toBe('Обновление…');
    const off = GazpromOffline.headerLabel({ offline: true });
    expect(off.status).toContain('Офлайн');
    expect(off.timeMode).toBe('hide');
    const on = GazpromOffline.headerLabel({ offline: false });
    expect(on.status).toBe('Локально сохранено');
    expect(on.timeMode).toBe('show');
  });

  it('markPending / clearPending / getPending', () => {
    expect(GazpromOffline.markPending('defaultsSeed')).toBe(true);
    expect(GazpromOffline.markPending('unknown')).toBe(false);
    expect(GazpromOffline.getPending().defaultsSeed).toBe(true);
    expect(GazpromOffline.hasPending()).toBe(true);
    GazpromOffline.clearPending('defaultsSeed');
    expect(GazpromOffline.getPending().defaultsSeed).toBe(false);
    expect(GazpromOffline.hasPending()).toBe(false);
  });

  it('flushPending runs only marked handlers and clears on success', async () => {
    const calls = [];
    GazpromOffline.markPending('defaultsSeed');
    GazpromOffline.markPending('buildCheck');
    const results = await GazpromOffline.flushPending({
      defaultsSeed: async () => {
        calls.push('defaultsSeed');
      },
      buildCheck: async () => {
        calls.push('buildCheck');
      },
      swUpdate: async () => {
        calls.push('swUpdate');
      },
    });
    expect(calls).toEqual(['defaultsSeed', 'buildCheck']);
    expect(results).toEqual({ defaultsSeed: 'ok', buildCheck: 'ok' });
    expect(GazpromOffline.hasPending()).toBe(false);
  });

  it('flushPending keeps flag when handler throws', async () => {
    GazpromOffline.markPending('buildCheck');
    const results = await GazpromOffline.flushPending({
      buildCheck: async () => {
        throw new Error('offline');
      },
    });
    expect(results.buildCheck).toBe('fail');
    expect(GazpromOffline.getPending().buildCheck).toBe(true);
  });
});
