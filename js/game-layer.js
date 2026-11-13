/** Игровой UX-слой: XP, ачивки, edition game|classic. Без бизнес-логики IDB/backup. */
window.GazpromGameLayer = (() => {
  const EDITION_KEY = 'gazprom-ui-edition';
  const XP_KEY = 'gazprom-game-xp';
  const ACH_KEY = 'gazprom-game-achievements';
  const XP_PER_LEVEL = 100;
  const XP_STEP = 15;
  const XP_DRAFT = 25;

  const ACHIEVEMENTS = [
    { id: 'first_sortie', title: 'Первый выход', desc: 'Открыл мастер полного акта', icon: '🥾' },
    { id: 'full_route', title: 'Полный маршрут', desc: 'Дошёл до шага генерации', icon: '🗺️' },
    { id: 'archivist', title: 'Архивариус', desc: 'Открыл историю', icon: '📚' },
    { id: 'elimination_guard', title: 'Страж устранения', desc: 'Открыл устранение', icon: '🛡️' },
  ];

  const WIZARD_STEPS_GAME = [
    'Сбор комиссии',
    'База организации',
    'Точка объекта',
    'Поле нарушений',
    'Выводы инспектора',
    'Штаб генерации',
  ];
  const SPRAVKA_STEPS_GAME = [
    'Дата выхода',
    'Объекты стройки',
    'Субподряд',
    'Личный состав',
    'Нарушения ПБ',
    'РММ и выводы',
    'Штаб справки',
  ];

  let classicWizardLabels = null;
  let classicSpravkaLabels = null;
  let hudEl = null;
  let xpToastEl = null;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* ignore quota */ }
  }

  function getEdition() {
    try {
      const v = localStorage.getItem(EDITION_KEY);
      if (v === 'classic' || v === 'game') return v;
    } catch (_) { /* ignore */ }
    return 'game';
  }

  function isGame() {
    return getEdition() === 'game';
  }

  function applyBodyClass() {
    const ed = getEdition();
    document.body.classList.toggle('gazprom-ui-game', ed === 'game');
    document.body.classList.toggle('gazprom-ui-classic', ed === 'classic');
  }

  function setEdition(edition) {
    const next = edition === 'classic' ? 'classic' : 'game';
    try {
      localStorage.setItem(EDITION_KEY, next);
    } catch (_) { /* ignore */ }
    applyBodyClass();
    applyLabels();
    syncToggleButtons();
    renderHud();
    renderAchievements();
    document.dispatchEvent(new CustomEvent('gazprom-ui-edition', { detail: { edition: next } }));
  }

  function getXp() {
    const n = parseInt(localStorage.getItem(XP_KEY) || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function setXp(n) {
    try {
      localStorage.setItem(XP_KEY, String(Math.max(0, Math.floor(n))));
    } catch (_) { /* ignore */ }
  }

  function getLevel(xp = getXp()) {
    return Math.floor(xp / XP_PER_LEVEL) + 1;
  }

  function levelProgress(xp = getXp()) {
    return xp % XP_PER_LEVEL;
  }

  function getAchievements() {
    const data = readJson(ACH_KEY, {});
    return data && typeof data === 'object' ? data : {};
  }

  function unlockAchievement(id) {
    const list = getAchievements();
    if (list[id]) return false;
    list[id] = new Date().toISOString();
    writeJson(ACH_KEY, list);
    renderAchievements();
    const meta = ACHIEVEMENTS.find((a) => a.id === id);
    if (meta && isGame() && window.GazpromToast) {
      GazpromToast.success(`Ачивка: ${meta.title}`);
    }
    return true;
  }

  function showXpToast(amount) {
    if (!isGame() || amount <= 0) return;
    if (!xpToastEl) {
      xpToastEl = document.createElement('div');
      xpToastEl.className = 'game-xp-toast';
      xpToastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(xpToastEl);
    }
    xpToastEl.innerHTML = `<span class="game-xp-toast__xp">+${amount} XP</span>`;
    xpToastEl.classList.remove('is-visible');
    void xpToastEl.offsetWidth;
    xpToastEl.classList.add('is-visible');
    clearTimeout(showXpToast._t);
    showXpToast._t = setTimeout(() => xpToastEl?.classList.remove('is-visible'), 1400);
  }

  function addXp(amount, { silent = false } = {}) {
    if (!amount || amount <= 0) return getXp();
    const before = getXp();
    const after = before + amount;
    const lvlBefore = getLevel(before);
    setXp(after);
    renderHud(true);
    if (!silent) showXpToast(amount);
    if (getLevel(after) > lvlBefore && isGame() && window.GazpromToast) {
      GazpromToast.success(`Уровень ${getLevel(after)}!`);
    }
    return after;
  }

  function ensureHud() {
    if (hudEl) return hudEl;
    const actions = document.querySelector('.header-actions');
    if (!actions) return null;
    hudEl = document.createElement('div');
    hudEl.className = 'game-hud';
    hudEl.id = 'gameHud';
    hudEl.innerHTML = `
      <div class="game-hud__badge" id="gameHudLevel" title="Уровень инспектора">1</div>
      <div class="game-hud__meta">
        <div class="game-hud__label" id="gameHudLabel">Ур. 1 · 0 XP</div>
        <div class="game-hud__track" aria-hidden="true">
          <div class="game-hud__fill" id="gameHudFill"></div>
        </div>
      </div>
    `;
    actions.insertBefore(hudEl, actions.firstChild);
    return hudEl;
  }

  function renderHud(bump = false) {
    const root = ensureHud();
    if (!root) return;
    const xp = getXp();
    const level = getLevel(xp);
    const prog = levelProgress(xp);
    const pct = Math.round((prog / XP_PER_LEVEL) * 100);
    const lvlEl = document.getElementById('gameHudLevel');
    const labelEl = document.getElementById('gameHudLabel');
    const fillEl = document.getElementById('gameHudFill');
    if (lvlEl) lvlEl.textContent = String(level);
    if (labelEl) labelEl.textContent = `Ур. ${level} · ${xp} XP`;
    if (fillEl) {
      fillEl.style.width = `${pct}%`;
      if (bump) {
        fillEl.classList.remove('is-bump');
        void fillEl.offsetWidth;
        fillEl.classList.add('is-bump');
      }
    }
  }

  function cacheClassicStepLabels() {
    if (!classicWizardLabels) {
      classicWizardLabels = Array.from(
        document.querySelectorAll('#wizardStepper .wizard-step-label')
      ).map((el) => el.textContent);
    }
    if (!classicSpravkaLabels) {
      classicSpravkaLabels = Array.from(
        document.querySelectorAll('#spravkaStepper .wizard-step-label')
      ).map((el) => el.textContent);
    }
  }

  function applyStepperLabels(stepperSel, gameLabels, classicLabels) {
    document.querySelectorAll(`${stepperSel} .wizard-step-label`).forEach((el, i) => {
      if (isGame()) {
        if (gameLabels[i]) el.textContent = gameLabels[i];
      } else if (classicLabels && classicLabels[i]) {
        el.textContent = classicLabels[i];
      }
    });
  }

  function applyLabels() {
    cacheClassicStepLabels();
    applyStepperLabels('#wizardStepper', WIZARD_STEPS_GAME, classicWizardLabels);
    applyStepperLabels('#spravkaStepper', SPRAVKA_STEPS_GAME, classicSpravkaLabels);

    document.querySelectorAll('[data-game-label][data-classic-label]').forEach((el) => {
      el.textContent = isGame()
        ? el.getAttribute('data-game-label')
        : el.getAttribute('data-classic-label');
    });
  }

  function wizardNextLabel(step, totalSteps) {
    if (!isGame()) {
      return step === totalSteps - 1 ? '💾 Сохранить черновик' : 'Далее →';
    }
    return step === totalSteps - 1 ? '🏁 Закрепить черновик' : 'Дальше по маршруту →';
  }

  function wizardPrevLabel() {
    return isGame() ? '← К локации' : '← Назад';
  }

  function spravkaNextLabel(step, totalSteps) {
    if (!isGame()) {
      return step === totalSteps - 1 ? 'Готово' : 'Далее →';
    }
    return step === totalSteps - 1 ? '🏁 Завершить справку' : 'Дальше по маршруту →';
  }

  function spravkaPrevLabel() {
    return isGame() ? '← К локации' : '← Назад';
  }

  function homeWizardCta(editable) {
    if (editable) {
      return isGame()
        ? `Продолжить миссию № ${editable.number}`
        : `Продолжить полный акт № ${editable.number}`;
    }
    return isGame() ? 'Полный маршрут проверки' : 'Создать полный акт';
  }

  function homeSpravkaCta(editableSpravka) {
    if (editableSpravka && window.SpravkaUtils?.isDraft?.(editableSpravka)) {
      const date = window.AktUtils?.formatDateShort?.(editableSpravka.date) || '';
      return isGame()
        ? `Продолжить справку-квест (${date})`
        : `Продолжить справку (${date})`;
    }
    return isGame() ? 'Справка по ПБ — квест' : 'Создать справку по ПБ';
  }

  function homeNewWizardLabel() {
    return isGame() ? 'Новая миссия (полный акт)' : 'Начать новый полный Акт';
  }

  function homeNewSpravkaLabel() {
    return isGame() ? 'Новая справка-квест' : 'Начать новую справку';
  }

  function pulseCurrentStep(stepperId) {
    if (!isGame()) return;
    const current = document.querySelector(`#${stepperId} .wizard-step.current`);
    if (!current) return;
    current.classList.remove('is-pulse');
    void current.offsetWidth;
    current.classList.add('is-pulse');
  }

  function onWizardStep(step, { advanced = false } = {}) {
    pulseCurrentStep('wizardStepper');
    if (advanced) addXp(XP_STEP);
    if (step >= 5) unlockAchievement('full_route');
  }

  function onSpravkaStep(step, { advanced = false } = {}) {
    pulseCurrentStep('spravkaStepper');
    if (advanced) addXp(XP_STEP);
  }

  function onDraftSaved(_kind) {
    addXp(XP_DRAFT);
  }

  function onScreen(screenId) {
    if (screenId === 'wizard') unlockAchievement('first_sortie');
    if (screenId === 'history') unlockAchievement('archivist');
    if (screenId === 'elimination') unlockAchievement('elimination_guard');
    if (screenId === 'wizard' || screenId === 'spravka') {
      requestAnimationFrame(() => {
        applyLabels();
      });
    }
  }

  function syncToggleButtons() {
    const ed = getEdition();
    document.getElementById('uiEditionGameBtn')?.classList.toggle('is-active', ed === 'game');
    document.getElementById('uiEditionClassicBtn')?.classList.toggle('is-active', ed === 'classic');
  }

  function renderAchievements() {
    const host = document.getElementById('gameAchievements');
    if (!host) return;
    const unlocked = getAchievements();
    host.innerHTML = ACHIEVEMENTS.map((a) => {
      const ok = Boolean(unlocked[a.id]);
      return `<div class="game-achievements__item${ok ? ' is-unlocked' : ''}">
        <div class="game-achievements__mark" aria-hidden="true">${a.icon}</div>
        <div>
          <div class="game-achievements__title">${a.title}${ok ? '' : ' · закрыто'}</div>
          <div class="game-achievements__desc">${a.desc}</div>
        </div>
      </div>`;
    }).join('');
  }

  function bindToggle() {
    document.getElementById('uiEditionGameBtn')?.addEventListener('click', () => setEdition('game'));
    document.getElementById('uiEditionClassicBtn')?.addEventListener('click', () => setEdition('classic'));
    syncToggleButtons();
  }

  function init() {
    applyBodyClass();
    cacheClassicStepLabels();
    applyLabels();
    renderHud();
    renderAchievements();
    bindToggle();
  }

  return {
    init,
    setEdition,
    getEdition,
    isGame,
    applyLabels,
    wizardNextLabel,
    wizardPrevLabel,
    spravkaNextLabel,
    spravkaPrevLabel,
    homeWizardCta,
    homeSpravkaCta,
    homeNewWizardLabel,
    homeNewSpravkaLabel,
    onWizardStep,
    onSpravkaStep,
    onDraftSaved,
    onScreen,
  };
})();
