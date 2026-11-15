import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wizardSrc = readFileSync(join(__dirname, '..', 'js', 'wizard.js'), 'utf8');

describe('wizard step conclusions — pred word search', () => {
  it('defines pred search query and filter element below wPredChips', () => {
    expect(wizardSrc).toContain('predSearchQuery');
    expect(wizardSrc).toContain('predMatchesSearch');
    expect(wizardSrc).toContain('id="wPredFilter"');
    expect(wizardSrc).toContain('id="wPredCatalogChips"');
    expect(wizardSrc).toMatch(
      /\$\{predSearchLine\}[\s\S]*id="wPredChips"/
    );
  });

  it('uses single organization filter', () => {
    expect(wizardSrc).toContain('predOrgFilter = predOrgFilter === org');
    expect(wizardSrc).not.toContain('predOrgFilters');
  });

  it('reveals catalog once on focus, not on each input', () => {
    expect(wizardSrc).toContain('predCatalogRevealDone');
    const block = wizardSrc.match(/function bindPredFilterLine[\s\S]*?function bind/)?.[0] || '';
    expect(block).toContain("addEventListener('focus'");
    const inputBlock = block.match(/addEventListener\('input'[\s\S]*?\n    \}\);/)?.[0] || '';
    expect(inputBlock).not.toContain('scrollMainWizardFieldIntoView');
  });

  it('refreshes catalog chips on filter input without replacing hint row', () => {
    expect(wizardSrc).toContain('refreshPredCatalogChips');
    expect(wizardSrc).toContain('bindPredFilterLine');
    expect(wizardSrc).toContain('Добавьте представителей организации');
  });
});