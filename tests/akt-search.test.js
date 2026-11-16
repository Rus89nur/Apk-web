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
  const ctx = { console, Date, Math, JSON, parseInt, String, Number, isNaN: Number.isNaN };
  vm.createContext(ctx);
  runScript(ctx, 'js/akt-utils.js', 'AktUtils');
  runScript(ctx, 'js/akt-search.js', 'AktSearch');
  return ctx;
}

function ids(list) {
  return list.map((akt) => akt.id);
}

function pill(active, dataset) {
  return {
    classList: { contains: (name) => active && name === 'active' },
    dataset,
  };
}

describe('AktSearch', () => {
  let AktSearch;

  const akt2025 = {
    id: 'y2025',
    number: '1',
    date: '2025-06-15T12:00:00',
    violations: [{ title: 'Замечание' }],
    urlToFllACT: '',
  };
  const akt2026 = {
    id: 'y2026',
    number: '2',
    date: '2026-06-15T12:00:00',
    violations: [{ title: 'Обычное' }],
    urlToFllACT: 'web:completed/y2026',
  };
  const akt2025clean = {
    id: 'y2025clean',
    number: '3',
    date: '2025-08-01T12:00:00',
    violations: [],
    urlToFllACT: 'web:completed/clean',
  };
  const akt2024 = {
    id: 'y2024',
    number: '4',
    date: '2024-06-15T12:00:00',
    violations: [{ title: 'Старое' }],
    urlToFllACT: '',
  };
  const akt2027 = {
    id: 'y2027',
    number: '7',
    date: '2027-06-15T12:00:00',
    violations: [{ title: 'Нарушение 2027' }],
    urlToFllACT: '',
  };
  const shortAkt = {
    id: 'short',
    number: '11',
    date: '2026-06-15T12:00:00',
    violations: [{ title: 'Сокращённый: пункт' }],
    urlToFllACT: 'web:completed/short',
  };
  const fullAkt = {
    id: 'full',
    number: '12',
    date: '2026-06-15T12:00:00',
    violations: [{ title: 'Полное' }],
    urlToFllACT: 'web:completed/full',
  };

  beforeAll(() => {
    AktSearch = loadScripts().AktSearch;
  });

  it('годы 2025 и 2026 с нарушениями оставляют эти акты и не требуют формат', () => {
    const akts = [akt2025, akt2026, akt2025clean, akt2024];
    const result = AktSearch.filterAkts(akts, { years: [2025, 2026], violationsOnly: true });
    expect(ids(result).sort()).toEqual(['y2025', 'y2026']);
  });

  it('все известные годы и нарушения оставляют акт 2027', () => {
    const akts = [akt2025, akt2026, akt2027, akt2025clean];
    const result = AktSearch.filterAkts(akts, {
      years: AktSearch.collectYears(akts),
      violationsOnly: true,
    });
    expect(ids(result)).toContain('y2027');
    expect(ids(result)).not.toContain('y2025clean');
  });

  it('только 2025 не включает акт 2027', () => {
    const akts = [akt2025, akt2026, akt2027];
    const result = AktSearch.filterAkts(akts, { years: [2025] });
    expect(ids(result)).not.toContain('y2027');
    expect(ids(result)).toContain('y2025');
  });

  it('пустые годы и выключенные флаги возвращают все акты', () => {
    const akts = [akt2025, akt2026, akt2027, shortAkt, fullAkt];
    const result = AktSearch.filterAkts(akts, {
      years: [],
      violationsOnly: false,
      draftsOnly: false,
      shortOnly: false,
      fullOnly: false,
    });
    expect(result).toHaveLength(akts.length);
    expect(ids(result)).toEqual(ids(akts));
  });

  it('сокращённые и полные вместе возвращают оба типа', () => {
    const result = AktSearch.filterAkts([shortAkt, fullAkt], { shortOnly: true, fullOnly: true });
    expect(result.length).toBeGreaterThan(0);
    expect(ids(result).sort()).toEqual(['full', 'short']);
  });

  it('только сокращённые не возвращает полный акт', () => {
    const result = AktSearch.filterAkts([shortAkt, fullAkt], { shortOnly: true });
    expect(ids(result)).toEqual(['short']);
    expect(ids(result)).not.toContain('full');
  });

  it('filterFromActivePills собирает годы числами и не берёт неактивные кнопки', () => {
    const filter = AktSearch.filterFromActivePills([
      pill(true, { filter: 'year', filterValue: '2027' }),
      pill(true, { filter: 'year', filterValue: '2025' }),
      pill(false, { filter: 'year', filterValue: '2024' }),
      pill(true, { filter: 'violations' }),
      pill(false, { filter: 'drafts' }),
      pill(true, { filter: 'short' }),
      pill(false, { filter: 'full' }),
      pill(true, { filter: 'all' }),
    ]);
    expect(filter.years).toEqual([2027, 2025]);
    expect(filter.years.every((year) => typeof year === 'number')).toBe(true);
    expect(filter.violationsOnly).toBe(true);
    expect(filter.shortOnly).toBe(true);
    expect(filter.draftsOnly).toBe(false);
    expect(filter.fullOnly).toBe(false);
  });

  it('collectYears возвращает уникальные годы по убыванию', () => {
    expect(
      AktSearch.collectYears([
        { date: '2027-06-15T12:00:00' },
        { date: '2025-03-01T12:00:00' },
        { date: '2027-11-02T12:00:00' },
        { date: '' },
        { date: 'нет' },
      ])
    ).toEqual([2027, 2025]);
  });
});
