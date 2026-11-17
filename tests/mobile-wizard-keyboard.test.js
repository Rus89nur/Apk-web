import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const overlaySrc = readFileSync(join(__dirname, '..', 'js', 'mobile-overlay.js'), 'utf8');

describe('mobile wizard keyboard / pred catalog scroll', () => {
  it('hides bottom nav and scrolls catalog on pred filter', () => {
    expect(overlaySrc).toContain('gazprom-wizard-keyboard');
    expect(overlaySrc).toContain('scrollMainWizardFieldIntoView');
    expect(overlaySrc).toContain('revealCatalog');
    expect(overlaySrc).toContain('wPredCatalogChips');
  });

  it('hides bottom nav for any screen text field including history search', () => {
    expect(overlaySrc).toMatch(
      /fieldFocused && \(keyboardOpen \|\| isCatalogFilter\)/
    );
    expect(overlaySrc).not.toMatch(
      /active\.id === 'screen-wizard' \|\| active\.id === 'screen-spravka'/
    );
  });
});