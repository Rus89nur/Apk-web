import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadViolationTemplates() {
  const ctx = { console };
  vm.createContext(ctx);
  const expose = '\nif (typeof ViolationTemplates !== "undefined") this.ViolationTemplates = ViolationTemplates;\n';
  vm.runInContext(readFileSync(join(root, 'js/violation-templates.js'), 'utf8') + expose, ctx);
  return ctx.ViolationTemplates;
}

describe('ViolationTemplates mesto suggestions', () => {
  let VT;
  beforeAll(() => {
    VT = loadViolationTemplates();
  });

  const places = ['Котельная №1', 'Склад ГСМ', 'Лестница 2 этаж'];

  it('при фокусе и исходном значении список скрыт', () => {
    expect(VT.filterMestoSuggestions(places, 'Котельная №1', 'Котельная №1')).toEqual([]);
  });

  it('пустое поле — без подсказок', () => {
    expect(VT.filterMestoSuggestions(places, '', '')).toEqual([]);
  });

  it('фильтр по подстроке при новом вводе', () => {
    const r = VT.filterMestoSuggestions(places, 'скл', '');
    expect(r).toEqual(['Склад ГСМ']);
  });

  it('collectMestaForSuggestions берёт только места текущего акта', () => {
    const r = VT.collectMestaForSuggestions({
      objectsCheck: [{ title: 'Объект проверки', subTitle: 'Адрес' }],
      violations: [{ mesto: 'Насосная' }, { mesto: 'Насосная' }, { mesto: 'Кровля' }, { mesto: '  ' }],
    });
    expect(r).toEqual(['Насосная', 'Кровля']);
  });

  it('не подмешивает места из других актов', () => {
    const r = VT.collectMestaForSuggestions({
      violations: [{ mesto: 'Цех 1' }],
    });
    expect(r).not.toContain('Чужой объект');
    expect(r).toEqual(['Цех 1']);
  });
});
