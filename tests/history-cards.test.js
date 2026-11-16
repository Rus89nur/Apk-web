import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function runScript(ctx, file, globalName) {
  const expose = `\nif (typeof ${globalName} !== "undefined") this.${globalName} = ${globalName};\n`;
  vm.runInContext(readFileSync(join(root, file), 'utf8') + expose, ctx);
}

function loadScripts() {
  const historyList = { innerHTML: '' };
  const document = {
    querySelector(sel) {
      if (sel === '#historyList') return historyList;
      return null;
    },
    querySelectorAll() {
      return { forEach() {} };
    },
  };
  const ctx = {
    console,
    Date,
    Math,
    JSON,
    parseInt,
    String,
    Number,
    isNaN: Number.isNaN,
    document,
    requestAnimationFrame() {},
  };
  vm.createContext(ctx);
  runScript(ctx, 'js/akt-utils.js', 'AktUtils');
  runScript(ctx, 'js/akt-search.js', 'AktSearch');
  runScript(ctx, 'js/ui-bindings.js', 'GazpromUI');
  return { ctx, historyList };
}

describe('карточки истории: выявлено', () => {
  let GazpromUI;
  let historyList;

  const three = {
    id: 'v3',
    number: '3',
    date: '2026-06-15T12:00:00',
    violations: [{ title: 'Первое' }, { title: 'Второе' }, { title: 'Третье' }],
    urlToFllACT: 'web:completed/v3',
  };
  const empty = {
    id: 'v0',
    number: '4',
    date: '2026-06-15T12:00:00',
    violations: [],
    urlToFllACT: 'web:completed/v0',
  };
  const missing = {
    id: 'vmiss',
    number: '5',
    date: '2026-06-15T12:00:00',
    urlToFllACT: 'web:completed/vmiss',
  };
  const shortTwo = {
    id: 'short2',
    number: '11',
    date: '2026-06-15T12:00:00',
    violations: [
      { title: 'Сокращённый: Обучение работников в области производственной безопасности' },
      { title: 'Сокращённый: Пожарная безопасность' },
    ],
    urlToFllACT: 'web:completed/short2',
  };
  const draft = {
    id: 'draft-1',
    number: '8',
    date: '2026-06-15T12:00:00',
    violations: [{ title: 'Черновое' }],
    urlToFllACT: '',
  };

  beforeAll(() => {
    const loaded = loadScripts();
    GazpromUI = loaded.ctx.GazpromUI;
    historyList = loaded.historyList;
  });

  function render(akt) {
    historyList.innerHTML = '';
    GazpromUI.renderHistory({ akts: [akt] });
    return historyList.innerHTML;
  }

  it('три нарушения показывают Выявлено: 3 и выявлено 3 в aria-label', () => {
    const html = render(three);
    expect(html).toContain('<span class="history-list-item__detected">Выявлено: 3</span>');
    expect(html).toContain('выявлено 3');
    expect(html).not.toContain('history-list-item__detected--empty');
  });

  it('пустой и отсутствующий violations дают Выявлено: 0 и класс --empty', () => {
    const emptyHtml = render(empty);
    expect(emptyHtml).toContain(
      '<span class="history-list-item__detected history-list-item__detected--empty">Выявлено: 0</span>'
    );
    expect(emptyHtml).toContain('выявлено 0');

    const missingHtml = render(missing);
    expect(missingHtml).toContain(
      '<span class="history-list-item__detected history-list-item__detected--empty">Выявлено: 0</span>'
    );
    expect(missingHtml).toContain('выявлено 0');
  });

  it('две записи сокращённого акта дают Выявлено: 2', () => {
    const html = render(shortTwo);
    expect(html).toContain('history-row--short');
    expect(html).toContain('<span class="history-list-item__detected">Выявлено: 2</span>');
    expect(html).toContain('выявлено 2');
    expect(html).not.toContain('history-list-item__detected--empty');
  });

  it('в разметке истории нет классов кольца устранения', () => {
    const html = [three, empty, shortTwo, draft].map(render).join('\n');
    expect(html).not.toContain('elimination-act-card');
    expect(html).not.toContain('elim-ring');
  });

  it('у черновика остаются data-history-trash и Черновик', () => {
    const html = render(draft);
    const detectedAt = html.indexOf('history-list-item__detected');
    const trashAt = html.indexOf('data-history-trash="draft-1"');
    const chevronAt = html.indexOf('history-list-item__chevron');
    expect(html).toContain('Черновик');
    expect(trashAt).toBeGreaterThan(detectedAt);
    expect(chevronAt).toBeGreaterThan(trashAt);
    expect(html).toContain('<span class="history-list-item__detected">Выявлено: 1</span>');
    expect(html).not.toContain('stopPropagation');
  });
});
