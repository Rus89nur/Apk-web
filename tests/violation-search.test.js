import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadViolationSearch() {
  const ctx = { console };
  vm.createContext(ctx);
  const expose = '\nif (typeof ViolationSearch !== "undefined") this.ViolationSearch = ViolationSearch;\n';
  vm.runInContext(readFileSync(join(root, 'js/violation-search.js'), 'utf8') + expose, ctx);
  return ctx.ViolationSearch;
}

const sampleRegistry = [
  {
    id: '1',
    number: 42,
    title: 'Не проведён инструктаж по охране труда',
    subTitle: 'п. 4.1 СП 12-135-2003',
    description: 'Повторное нарушение на объекте',
    vid: 'Пожарная безопасность',
    formulaFromRules: 'Согласно п. 4.1',
  },
  {
    id: '2',
    number: 7,
    title: 'Отсутствуют средства пожаротушения',
    subTitle: 'ФЗ-123',
    description: '',
    vid: 'Пожароопасные работы',
    formulaFromRules: '',
  },
];

describe('ViolationSearch', () => {
  let VS;
  beforeAll(() => {
    VS = loadViolationSearch();
  });

  it('normalize: ё, пунктуация, лишние пробелы', () => {
    expect(VS.normalize('  Ёлка,  «тест»  ')).toBe('елка тест');
  });

  it('ищет по примечанию (description)', () => {
    const r = VS.filterRegistry(sampleRegistry, 'повторное');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');
  });

  it('несколько слов — логика И', () => {
    const r = VS.filterRegistry(sampleRegistry, 'инструктаж охране');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');

    expect(VS.filterRegistry(sampleRegistry, 'инструктаж пожаротушения')).toHaveLength(0);
  });

  it('ищет по номеру записи', () => {
    const r = VS.filterRegistry(sampleRegistry, '42');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');
  });

  it('ищет по виду нарушения', () => {
    const r = VS.filterRegistry(sampleRegistry, 'пожароопасные');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('2');
  });

  it('кавычки — точная фраза', () => {
    const r = VS.filterRegistry(sampleRegistry, '"средства пожаротушения"');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('2');
  });

  it('vidFilter совместим с поиском', () => {
    const r = VS.filterRegistry(sampleRegistry, 'пожар', { vidFilter: 'Пожарная безопасность' });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');
  });

  it('filterActViolations: место и ссылка на правило', () => {
    const violations = [
      {
        id: 'a',
        title: 'Нарушение А',
        mesto: 'Котельная №3',
        urlToPravilo: 'п. 2.3 ППБ',
        description: 'замечание инспектора',
      },
    ];
    expect(VS.filterActViolations(violations, 'котельная').map((v) => v.id)).toEqual(['a']);
    expect(VS.filterActViolations(violations, 'инспектора').map((v) => v.id)).toEqual(['a']);
    expect(VS.filterActViolations(violations, 'ппб').map((v) => v.id)).toEqual(['a']);
  });

  it('пустой запрос — все записи', () => {
    expect(VS.filterRegistry(sampleRegistry, '')).toHaveLength(2);
    expect(VS.filterRegistry(sampleRegistry, '   ')).toHaveLength(2);
  });

  it('placesMatch: дефис, №, ведущие нули и пустая строка', () => {
    expect(VS.placesMatch('вагон-дом №3', 'вагон-дом 3')).toBe(true);
    expect(VS.placesMatch('вагон-дом 3', 'вагон дом 3')).toBe(true);
    expect(VS.placesMatch('вагон-дом №3', 'вагон дом 3')).toBe(true);
    expect(VS.placesMatch('Ёлка', 'елка')).toBe(true);
    expect(VS.placesMatch('вагон-дом №03', 'вагон-дом 3')).toBe(true);
    expect(VS.placesMatch('дом 3', 'вагон-дом 3')).toBe(false);
    expect(VS.placesMatch('', 'вагон-дом 3')).toBe(false);
    expect(VS.placesMatch('', '')).toBe(false);
  });

  const fixture44 = {
    id: '44',
    number: 44,
    title: 'Помещения электрощитовых не оснащены огнетушителями',
    subTitle: 'п. 60 Правил противопожарного режима',
    description: 'Электрощитовая',
    vid: 'Пожарная безопасность',
    formulaFromRules: 'указанных в паспорте огнетушителя',
  };
  const fixture70 = {
    id: '70',
    number: 70,
    title: 'Работник находится на строительной площадке без каски',
    subTitle: 'п. 30 Правил по охране труда',
    description: 'Нет СИЗ или Каски на строительной площадке',
    vid: 'Обеспечение работников СИЗ',
    formulaFromRules: 'Лица, находящиеся на строительной площадке, обязаны носить защитные каски.',
  };
  const softFixture = [fixture44, fixture70];
  const softQueries = [
    'нет огнетушителя в щитовой',
    'огнетушитель щитовая',
    'рабочий без шлема',
    'огнетушитиль',
    'ппр 60',
  ];

  function numbersOf(result) {
    return result.ranked.map((row) => row.item.number);
  }

  it('suggestRegistry находит 44 и 70 там, где filterRegistry пуст', () => {
    for (const query of softQueries) {
      expect(VS.filterRegistry(softFixture, query)).toEqual([]);
    }

    expect(numbersOf(VS.suggestRegistry(softFixture, 'нет огнетушителя в щитовой'))).toContain(44);
    expect(numbersOf(VS.suggestRegistry(softFixture, 'огнетушитель щитовая'))).toContain(44);
    expect(numbersOf(VS.suggestRegistry(softFixture, 'щитовой'))).toContain(44);

    const helmet = VS.suggestRegistry(softFixture, 'рабочий без шлема');
    const row70 = helmet.ranked.find((row) => row.item.number === 70);
    expect(row70).toBeTruthy();
    expect(row70.reasons).toContain('синоним');

    const typo = VS.suggestRegistry(softFixture, 'огнетушитиль');
    const row44 = typo.ranked.find((row) => row.item.number === 44);
    expect(row44).toBeTruthy();
    expect(row44.reasons).toContain('исправлена опечатка');
  });

  it('частичное совпадение ниже полного', () => {
    const items = [
      { id: 'part', number: 1, title: 'Огнетушитель в коридоре' },
      { id: 'full', number: 5, title: 'Огнетушитель в щитовой' },
    ];
    const result = VS.suggestRegistry(items, 'огнетушитель щитовая');
    expect(result.empty).toBe(false);
    expect(result.ranked[0].item.id).toBe('full');
    expect(result.ranked[0].full).toBe(true);
    const part = result.ranked.find((row) => row.item.id === 'part');
    expect(part.full).toBe(false);
    expect(part.matched).toBeLessThan(part.required);
  });

  it('фраза в кавычках, которой нет в тексте, исключает запись', () => {
    const items = [{ id: '1', number: 44, title: 'Помещения электрощитовых не оснащены огнетушителями' }];
    const missed = VS.suggestRegistry(items, '"нет такой фразы" огнетушитель');
    expect(missed.empty).toBe(false);
    expect(missed.ranked).toHaveLength(0);

    const hit = VS.suggestRegistry(items, '"огнетушителями"');
    expect(hit.ranked).toHaveLength(1);
    expect(hit.ranked[0].full).toBe(true);
  });

  it('placeCounts поднимает запись и открывает карточку лидера только при отрыве', () => {
    const items = [
      { id: 'low', number: 1, title: 'Каска у входа' },
      { id: 'high', number: 2, title: 'Каска на полу' },
    ];
    const key = VS.normalize('Каска на полу');
    const withPlace = VS.suggestRegistry(items, 'каска', { placeCounts: { [key]: 2 } });
    expect(withPlace.ranked[0].item.id).toBe('high');
    expect(withPlace.ranked[0].reasons).toContain('часто в этом месте');
    expect(VS.shouldShowLeader(withPlace.ranked)).toBe(true);

    const plain = VS.suggestRegistry(items, 'каска');
    expect(plain.ranked[0].score).toBe(plain.ranked[1].score);
    expect(VS.shouldShowLeader(plain.ranked)).toBe(false);

    expect(VS.shouldShowLeader([
      { full: true, score: 135 },
      { full: true, score: 100 },
    ])).toBe(true);
    expect(VS.shouldShowLeader([
      { full: true, score: 134 },
      { full: true, score: 100 },
    ])).toBe(false);
    expect(VS.shouldShowLeader([{ full: false, score: 500 }])).toBe(false);
    expect(VS.shouldShowLeader([{ full: true, score: 10 }])).toBe(true);
    expect(VS.shouldShowLeader([])).toBe(false);
    expect(VS.shouldShowLeader([{ full: true, score: 0 }])).toBe(false);
    expect(VS.LEADER_SCORE_RATIO).toBe(1.35);
    expect(VS.PLACE_BONUS).toBe(30);
  });

  it('реестр по умолчанию: filterRegistry пуст, suggestRegistry находит 44, 70 и ппр', () => {
    const registry = JSON.parse(
      readFileSync(join(root, 'assets/defaults/violation-registry.json'), 'utf8')
    ).items;
    for (const query of softQueries) {
      expect(VS.filterRegistry(registry, query)).toEqual([]);
    }
    expect(numbersOf(VS.suggestRegistry(registry, 'нет огнетушителя в щитовой'))).toContain(44);
    expect(numbersOf(VS.suggestRegistry(registry, 'огнетушитель щитовая'))).toContain(44);
    expect(numbersOf(VS.suggestRegistry(registry, 'огнетушитиль'))).toContain(44);
    const helmet = VS.suggestRegistry(registry, 'рабочий без шлема');
    const row70 = helmet.ranked.find((row) => row.item.number === 70);
    expect(row70).toBeTruthy();
    expect(row70.reasons).toContain('синоним');
    const typo = VS.suggestRegistry(registry, 'огнетушитиль').ranked.find((row) => row.item.number === 44);
    expect(typo.reasons).toContain('исправлена опечатка');
    expect(VS.suggestRegistry(registry, 'ппр 60').ranked.length).toBeGreaterThan(0);
  });

  it('mapPhotoHints: пороги и привязка, predict не вызывается', () => {
    expect(String(VS.mapPhotoHints)).not.toMatch(/\.predict\s*\(/);
    const registry = [fixture44, fixture70];
    const hints = VS.mapPhotoHints([
      {
        violationTitle: fixture44.title,
        registryOrderNumber: 44,
        confidence: 0.5,
      },
      {
        violationTitle: fixture70.title,
        registryOrderNumber: 70,
        confidence: 0.2,
      },
    ], registry);
    expect(hints).toHaveLength(1);
    expect(hints[0].confidence).toBe(0.5);
    expect(hints[0].percent).toBe(50);
    expect(hints[0].item.number).toBe(44);

    expect(VS.mapPhotoHints([
      { violationTitle: fixture44.title, registryOrderNumber: 44, confidence: 0.3 },
    ], registry)).toEqual([]);

    expect(VS.mapPhotoHints([
      { violationTitle: 'Совсем неизвестное нарушение', confidence: 0.91 },
    ], registry)).toEqual([]);

    const byNumber = VS.mapPhotoHints([
      { violationTitle: 'другая подпись', registryOrderNumber: 70, confidence: 0.8 },
    ], registry);
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0].item.number).toBe(70);
    expect(VS.PHOTO_HINT_MIN_ITEM).toBe(0.25);
    expect(VS.PHOTO_HINT_MIN_TOP).toBe(0.35);
  });
});
