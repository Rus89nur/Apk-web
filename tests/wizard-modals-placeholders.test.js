import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const wizardModalsSrc = readFileSync(join(root, 'js/wizard-modals.js'), 'utf8');

describe('wizard-modals violation editor placeholders', () => {
  it('defines MV_PLACEHOLDER_NEW with database hints', () => {
    expect(wizardModalsSrc).toContain('MV_PLACEHOLDER_NEW');
    expect(wizardModalsSrc).toContain(
      'Здесь будет формулировка нарушения из базы нарушений'
    );
    expect(wizardModalsSrc).toContain(
      'Здесь будет пункт или ссылка на правило из базы нарушений'
    );
    expect(wizardModalsSrc).toContain(
      'Здесь будет формулировка из правил из базы нарушений'
    );
  });

  it('picks placeholders by violationId', () => {
    expect(wizardModalsSrc).toContain('MV_PLACEHOLDER_EDIT');
    expect(wizardModalsSrc).toMatch(
      /violationId\s*==\s*null\s*\?\s*MV_PLACEHOLDER_NEW\s*:\s*MV_PLACEHOLDER_EDIT/
    );
  });
});