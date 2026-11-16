/**
 * Модальные окна мастера: нарушение, быстрое добавление в справочник.
 */
const WizardModals = (() => {
  const SAVE_TIMEOUT_MS = 60000;
  /** Подсказки по фото в модалке нарушения — отключены (ML даёт неточные совпадения). */
  const VIOLATION_REGISTRY_PHOTO_HINTS = false;

  const MV_PLACEHOLDER_NEW = {
    title: 'Здесь — формулировка из базы',
    url: 'Здесь — пункт правила из базы',
    formula: 'Здесь — формулировка из правил',
  };

  const MV_PLACEHOLDER_EDIT = {
    title: 'Не проведён инструктаж по охране труда…',
    url: 'п. 4.1 СП 12-135-2003',
    formula: 'Согласно п. …',
  };

  let ctx = null;
  let editingViolationId = null;
  let linkedRegistryItemId = null;
  let modalPhotos = [];
  let savingViolation = false;
  let violationFormInitial = null;
  let photoHintGen = 0;
  let photoHintsDismissed = false;
  let afterModalPhotosCleared = null;
  /** Вызывается после добавления фото в открытой модалке (фотофиксация или кнопка у поиска). */
  let photoPickHintHandler = null;
  const RECENT_REGISTRY_KEY = 'apkGi.registryRecentIds';
  const RECENT_REGISTRY_MAX = 8;

  function readRecentRegistryIds() {
    try {
      const raw = localStorage.getItem(RECENT_REGISTRY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const ids = [];
      for (const value of parsed) {
        if (typeof value !== 'string' || !value) return [];
        ids.push(value);
      }
      return ids.slice(0, RECENT_REGISTRY_MAX);
    } catch {
      return [];
    }
  }

  function rememberRecentRegistryId(id) {
    if (!id || typeof id !== 'string') return;
    try {
      const prev = readRecentRegistryIds().filter((value) => value !== id);
      localStorage.setItem(
        RECENT_REGISTRY_KEY,
        JSON.stringify([id, ...prev].slice(0, RECENT_REGISTRY_MAX))
      );
    } catch {
      /* каталог и форма от этого не зависят */
    }
  }

  function hidePhotoHints() {
    const el = document.getElementById('mvPhotoHints');
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
  }

  const isSavingViolation = () => savingViolation;

  const withSaveTimeout = (promise, message) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(
          () =>
            reject(
              new Error(
                message ||
                  'Сохранение заняло слишком много времени. Проверьте соединение и попробуйте снова.'
              )
            ),
          SAVE_TIMEOUT_MS
        );
      }),
    ]);

  function ensureModalRoot() {
    let root = document.getElementById('wizardModalRoot');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'wizardModalRoot';
    root.className = 'modal-root';
    root.hidden = true;
    root.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal-dialog" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 id="modalTitle">—</h3>
          <button type="button" class="modal-close" data-close aria-label="Закрыть">×</button>
        </div>
        <div class="modal-body" id="modalBody"></div>
        <div class="modal-footer" id="modalFooter"></div>
      </div>
    `;
    document.body.appendChild(root);
    if (!root.dataset.closeBound) {
      root.dataset.closeBound = '1';
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) {
          e.preventDefault();
          void requestClose();
        }
      });
    }
    return root;
  }

  function open(title, bodyHtml, footerHtml) {
    const root = ensureModalRoot();
    root.hidden = false;
    root.classList.add('show');
    GazpromMobileOverlay.lock();
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalFooter').innerHTML = footerHtml || '';
    GazpromMobileOverlay.syncWizardModalViewport?.();
    AktUtils.scanNativeSpellcheck(root);
  }

  function readFieldRaw(id) {
    return document.getElementById(id)?.value ?? '';
  }

  function isBlankText(text) {
    return !String(text ?? '').trim();
  }

  function readViolationFormSnapshot() {
    return {
      title: readFieldRaw('mvTitle'),
      mesto: readFieldRaw('mvMesto'),
      subTitle: readFieldRaw('mvUrl'),
      vid: document.getElementById('mvVid')?.value || '',
      formulaFromRules: readFieldRaw('mvFormula'),
      photoCount: modalPhotos.length,
    };
  }

  function isViolationFormDirty() {
    if (!violationFormInitial) return false;
    const current = readViolationFormSnapshot();
    return (
      current.title !== violationFormInitial.title ||
      current.mesto !== violationFormInitial.mesto ||
      current.subTitle !== violationFormInitial.subTitle ||
      current.vid !== violationFormInitial.vid ||
      current.formulaFromRules !== violationFormInitial.formulaFromRules ||
      current.photoCount !== violationFormInitial.photoCount
    );
  }

  async function requestClose(options = {}) {
    if (savingViolation) {
      GazpromToast.info('Дождитесь завершения сохранения…');
      return;
    }
    if (!options.skipConfirm && isViolationFormDirty()) {
      const ok = await GazpromToast.confirm('Закрыть без сохранения?', {
        confirmLabel: 'Закрыть',
        danger: true,
      });
      if (!ok) return;
    }
    close(options);
  }

  function close(options = {}) {
    const root = document.getElementById('wizardModalRoot');
    const active = document.activeElement;
    if (active && root?.contains(active)) {
      active.blur();
    }
    if (root) {
      root.classList.remove('show', 'wizard-modal--keyboard');
      root.hidden = true;
    }
    GazpromMobileOverlay.unlock();
    GazpromMobileOverlay.syncWizardModalViewport?.();
    if (!options.deferRecover) {
      GazpromMobileOverlay.scheduleRecoverViewportLayout?.();
    }
    editingViolationId = null;
    linkedRegistryItemId = null;
    modalPhotos = [];
    savingViolation = false;
    violationFormInitial = null;
    photoHintGen += 1;
    photoHintsDismissed = false;
    afterModalPhotosCleared = null;
    photoPickHintHandler = null;
    window.__gazpromSavingViolation = false;
  }

  /** Подставить сохранённый вид в select (после mount DOM) — без подмены на новый. */
  function applyViolationVidSelect(rawVid) {
    const vidEl = document.getElementById('mvVid');
    if (!vidEl) return;
    const raw = String(rawVid || '').trim();
    if (!raw) return;
    if (!Array.from(vidEl.options).some((o) => o.value === raw)) {
      const opt = document.createElement('option');
      opt.value = raw;
      opt.textContent = raw;
      vidEl.insertBefore(opt, vidEl.options[1] || null);
    }
    if (Array.from(vidEl.options).some((o) => o.value === raw)) {
      vidEl.value = raw;
    }
  }

  function setSaveButtonsBusy(busy, label = 'Сохранение…') {
    const saveBtn = document.getElementById('mvSave');
    if (saveBtn) {
      saveBtn.disabled = busy;
      if (busy) saveBtn.textContent = label;
      else if (saveBtn.dataset.defaultLabel) saveBtn.textContent = saveBtn.dataset.defaultLabel;
    }
  }

  async function finalizePhotoRefs(photos) {
    if (!photos?.length) return [];
    if (typeof PhotoStore?.ingestPhotoRefs === 'function') {
      return PhotoStore.ingestPhotoRefs(photos);
    }
    if (typeof PhotoStore?.ingestPhotoRef !== 'function') return [...photos];
    const out = [];
    for (const p of photos) {
      if (!p) continue;
      if (PhotoStore.isPhotoId(p)) {
        out.push(p);
        continue;
      }
      const result = await PhotoStore.ingestPhotoRef(p);
      if (result?.id) out.push(result.id);
    }
    return out;
  }

  function finishViolationSave(onUpdate) {
    close({ deferRecover: true });
    window.__gazpromSavingViolation = false;
    onUpdate?.();
    requestAnimationFrame(() => {
      GazpromMobileOverlay?.scheduleRecoverViewportLayout?.();
    });
  }

  function bindPhotoHintDismiss(el) {
    el?.querySelector('#mvPhotoHintsReset')?.addEventListener('click', () => {
      photoHintsDismissed = true;
      photoHintGen += 1;
      hidePhotoHints();
    });
  }

  function ensureMvPhotoInputBound() {
    const input = document.getElementById('mvPhotoInput');
    if (!input || input.dataset.mvViolationPhotoBound === '1') return;
    input.dataset.mvViolationPhotoBound = '1';
    input.addEventListener('change', async (e) => {
      const added = await onPhotoPick(e);
      if (VIOLATION_REGISTRY_PHOTO_HINTS && added?.length && photoPickHintHandler) photoPickHintHandler(added);
    });
  }

  function init(context) {
    ctx = context;
    ensureMvPhotoInputBound();
  }

  /** Одна строка: line-height + padding + border (пустое поле). */
  function getSingleLineTextareaHeight(el) {
    if (!el) return 48;
    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight);
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const paddingBottom = parseFloat(cs.paddingBottom) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
    const line = Number.isFinite(lineHeight) ? lineHeight : 24;
    return Math.ceil(line + paddingTop + paddingBottom + borderTop + borderBottom);
  }

  /** Высота под весь текст: сначала одна строка, затем scrollHeight — без обрезки. */
  function autoResize(el) {
    if (!el) return;
    const singleLine = getSingleLineTextareaHeight(el);
    el.style.overflow = 'hidden';
    el.style.overflowY = 'hidden';
    el.style.height = `${singleLine}px`;
    const h = Math.max(el.scrollHeight, singleLine);
    el.style.height = `${h}px`;
  }

  function resizeViolationTextareas() {
    ['mvTitle', 'mvUrl', 'mvFormula'].forEach((id) => {
      autoResize(document.getElementById(id));
    });
  }

  function scheduleViolationTextareaResize() {
    requestAnimationFrame(() => {
      resizeViolationTextareas();
      requestAnimationFrame(() => {
        resizeViolationTextareas();
        GazpromMobileOverlay.syncWizardModalViewport?.();
      });
    });
  }

  function bindAutoResize(el) {
    if (!el) return;
    el.addEventListener('input', () => autoResize(el));
    el.addEventListener('focus', () => {
      autoResize(el);
      if (el.id === 'mvTitle') {
        GazpromMobileOverlay.syncWizardModalViewport?.();
      }
    });
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result;
        resolve(typeof r === 'string' && r.includes(',') ? r.split(',')[1] : r);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function objectOptions(objects, selectedTitle) {
    const opts = (objects || [])
      .map(
        (o) =>
          `<option value="${AktUtils.escapeHtml(o.title)}" ${o.title === selectedTitle ? 'selected' : ''}>${AktUtils.formatObjectHtml(o)}</option>`
      )
      .join('');
    return `<option value="">— выберите объект —</option>${opts}`;
  }

  function openViolationEditor(violationId) {
    const draft = ctx.getDraft();
    const catalog = ctx.getCatalog();
    editingViolationId = violationId;
    photoHintGen += 1;
    photoHintsDismissed = false;
    afterModalPhotosCleared = () => {
      photoHintGen += 1;
      hidePhotoHints();
    };
    const v =
      violationId != null
        ? (draft.violations || []).find((x) => x.id === violationId)
        : null;

    modalPhotos = v?.photo ? [...v.photo] : [];

    const originalMesto = String(v?.mesto || '').trim();
    const mestoSuggestions =
      typeof ViolationTemplates !== 'undefined'
        ? ViolationTemplates.collectMestaForSuggestions(draft)
        : [...new Set((draft.violations || []).map((x) => x.mesto).filter(Boolean))];

    function renderMestoSuggestions(query) {
      const items =
        typeof ViolationTemplates !== 'undefined'
          ? ViolationTemplates.filterMestoSuggestions(mestoSuggestions, query, originalMesto)
          : mestoSuggestions.filter((m) => {
              const q = String(query || '').trim().toLowerCase();
              return q && m.toLowerCase().includes(q) && m.toLowerCase() !== q;
            });
      if (!items.length) return '';
      return items
        .map(
          (m) =>
            `<button type="button" class="mesto-suggestion-item" data-mesto="${AktUtils.escapeHtml(m)}">${AktUtils.escapeHtml(m)}</button>`
        )
        .join('');
    }

    const savedVid = String(v?.vid || '').trim();
    const vidTitles =
      catalog && typeof ViolationTypes !== 'undefined'
        ? ViolationTypes.getVidSelectTitles(catalog, savedVid)
        : [];
    const vidOpts = vidTitles
      .map(
        (t) =>
          `<option value="${AktUtils.escapeHtml(t)}" ${savedVid === t ? 'selected' : ''}>${AktUtils.escapeHtml(t)}</option>`
      )
      .join('');

    function getRegistryItems() {
      return ctx.getCatalog?.()?.violationRegistry || catalog?.violationRegistry || [];
    }

    function currentMestoValue() {
      const el = document.getElementById('mvMesto');
      if (el) return el.value || '';
      return v?.mesto || '';
    }

    function alreadyInAct(title) {
      const key = ViolationSearch.normalize(title);
      if (!key) return false;
      const liveDraft = ctx.getDraft?.();
      return (liveDraft?.violations || []).some(
        (viol) => viol && viol.id !== editingViolationId && ViolationSearch.normalize(viol.title) === key
      );
    }

    function alreadyBadge(title) {
      return alreadyInAct(title)
        ? '<span class="mv-suggest-badge">уже в акте</span>'
        : '';
    }

    function displayVidOf(item) {
      const live = ctx.getCatalog?.() || catalog;
      if (live && typeof ViolationTypes !== 'undefined') {
        return ViolationTypes.resolveVid(live, item?.vid) || '';
      }
      return item?.vid || '';
    }

    function registryItemForNorm(items, key) {
      let best = null;
      for (const item of items || []) {
        if (ViolationSearch.normalize(item?.title) !== key) continue;
        if (!best || (item.number || 0) < (best.number || 0)) best = item;
      }
      return best;
    }

    /** Текст из акта часто короче формулировки реестра — подбираем через умный поиск. */
    function registryItemForUserTitle(rawTitle) {
      const title = String(rawTitle || '').trim();
      if (!title) return null;
      const items = getRegistryItems();
      const exact = resolveRegistryItem(items, { title, titleKey: registryTitleKey(title) });
      if (exact) return exact;
      const actKey = registryTitleKey(title);
      if (actKey.length >= 28) {
        const prefix = actKey.slice(0, Math.min(55, actKey.length));
        const byPrefix = items.find((item) => registryTitleKey(item?.title).startsWith(prefix));
        if (byPrefix) return byPrefix;
      }
      const { ranked } = ViolationSearch.suggestRegistry(items, title);
      const top = ranked[0];
      if (!top?.item) return null;
      if (top.full) return top.item;
      const regKey = registryTitleKey(top.item.title);
      if (actKey.length >= 25 && regKey.length >= 25) {
        const n = Math.min(52, actKey.length, regKey.length);
        if (actKey.slice(0, n) === regKey.slice(0, n)) return top.item;
      }
      if (top.matched >= 2) return top.item;
      const second = ranked[1];
      if (top.score >= 80 && (!second || top.score >= second.score * 1.2)) return top.item;
      return null;
    }

    let placeStatsCacheKey = null;
    let placeStatsCache = { counts: {}, top: [] };

    function invalidatePlaceStatsCache() {
      placeStatsCacheKey = null;
    }

    function placeStatsForCurrentMesto() {
      const mesto = currentMestoValue().trim();
      if (!mesto) return { counts: {}, top: [] };
      if (placeStatsCacheKey === mesto) return placeStatsCache;
      placeStatsCacheKey = mesto;
      placeStatsCache = collectPlaceStats(mesto);
      return placeStatsCache;
    }

    function collectPlaceStats(mesto) {
      const place = String(mesto || '').trim();
      const counts = {};
      const buckets = new Map();
      if (!place || typeof ViolationSearch?.placesMatch !== 'function') {
        return { counts, top: [] };
      }
      const catalogNow = ctx.getCatalog?.() || {};
      const liveDraft = typeof ctx.getDraft === 'function' ? ctx.getDraft() : null;
      const byId = new Map();
      const loose = [];
      const addAkt = (akt) => {
        if (!akt || typeof akt !== 'object') return;
        if (akt.id) byId.set(akt.id, akt);
        else loose.push(akt);
      };
      for (const akt of catalogNow.akts || []) addAkt(akt);
      for (const akt of catalogNow.trash || []) addAkt(akt);
      if (liveDraft) {
        if (liveDraft.id) byId.set(liveDraft.id, liveDraft);
        else loose.push(liveDraft);
      }
      const registry = getRegistryItems();
      for (const akt of [...byId.values(), ...loose]) {
        for (const viol of akt.violations || []) {
          if (!ViolationSearch.placesMatch(viol?.mesto, place)) continue;
          const rawTitle = String(viol?.title || '').trim();
          const key = ViolationSearch.normalize(rawTitle);
          if (!key) continue;
          const reg = registryItemForNorm(registry, key) || registryItemForUserTitle(rawTitle);
          if (!reg?.title) continue;
          const registryKey = ViolationSearch.normalize(reg.title);
          if (!registryKey) continue;
          counts[registryKey] = (counts[registryKey] || 0) + 1;
          if (!buckets.has(registryKey)) {
            buckets.set(registryKey, { reg, count: 0, title: reg.title });
          }
          buckets.get(registryKey).count += 1;
        }
      }
      const top = [...buckets.values()]
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ru'))
        .slice(0, 5)
        .map((row) => ({
          key: ViolationSearch.normalize(row.title),
          count: row.count,
          title: row.title,
          reg: row.reg,
          display: row.title,
        }));
      return { counts, top };
    }

    function recentRegistryItems(items) {
      const out = [];
      const seen = new Set();
      for (const id of readRecentRegistryIds()) {
        if (seen.has(id)) continue;
        seen.add(id);
        const item = (items || []).find((row) => row.id === id);
        if (item) out.push(item);
      }
      return out;
    }

    function isBrowseQuery(query) {
      const parsed = ViolationSearch.parseQuery(query);
      if (parsed.phrases?.length) return false;
      const stop = ViolationSearch.STOP_WORDS;
      return !(parsed.tokens || []).some((token) => !stop?.has?.(token));
    }

    function registryTitleKey(title) {
      return ViolationSearch.normalize(title || '');
    }

    function resolveRegistryItem(items, { id, number, titleKey, title }) {
      const list = items || [];
      if (id) {
        const byId = list.find((row) => row.id === id);
        if (byId) return byId;
      }
      if (number !== undefined && number !== null && String(number).trim() !== '') {
        const n = Number(number);
        const byNum = list.find((row) => row.number === n || String(row.number) === String(number));
        if (byNum) return byNum;
      }
      const key = titleKey || registryTitleKey(title);
      if (key) {
        const byNorm = registryItemForNorm(list, key);
        if (byNorm) return byNorm;
        return list.find((row) => registryTitleKey(row.title) === key) || null;
      }
      return null;
    }

    function registryRowDataset(item) {
      const hasNumber = item?.number !== undefined && item?.number !== null && String(item.number).trim() !== '';
      const titleKey = registryTitleKey(item?.title);
      return {
        id: item?.id || '',
        number: hasNumber ? String(item.number) : '',
        titleKey,
      };
    }

    function resultRowHtml(item, index, extraHtml) {
      const displayVid = displayVidOf(item);
      const ds = registryRowDataset(item);
      const numLabel = ds.number || '·';
      return `
          <div class="viol-registry-result-item" data-reg-id="${AktUtils.escapeHtml(ds.id)}" data-reg-number="${AktUtils.escapeHtml(ds.number)}" data-reg-title="${AktUtils.escapeHtml(ds.titleKey)}">
            <span class="vr-result-num${ds.number ? '' : ' vr-result-num--muted'}">${AktUtils.escapeHtml(numLabel)}</span>
            <div class="vr-result-body">
              <div class="vr-result-title">${AktUtils.escapeHtml(item.title || '')}${alreadyBadge(item.title)}</div>
              ${item.subTitle ? `<div class="vr-result-sub">📄 ${AktUtils.escapeHtml(item.subTitle)}</div>` : ''}
              ${displayVid ? `<span class="vr-result-vid">${AktUtils.escapeHtml(displayVid)}</span>` : ''}
              ${extraHtml || ''}
            </div>
          </div>`;
    }

    function renderPlainList(items) {
      return (items || []).map((item, index) => resultRowHtml(item, index)).join('');
    }

    function renderFreqBlock(rows) {
      if (!rows.length) return '';
      const body = rows
        .filter((row) => row?.reg)
        .map((row) => {
          const item = row.reg;
          const ds = registryRowDataset(item);
          return `
          <div class="viol-registry-result-item" data-reg-id="${AktUtils.escapeHtml(ds.id)}" data-reg-number="${AktUtils.escapeHtml(ds.number)}" data-reg-title="${AktUtils.escapeHtml(ds.titleKey)}">
            <span class="vr-result-num${ds.number ? '' : ' vr-result-num--muted'}">${AktUtils.escapeHtml(ds.number || '·')}</span>
            <div class="vr-result-body">
              <div class="vr-result-title">${AktUtils.escapeHtml(item.title || '')}${alreadyBadge(item.title)}</div>
              <div class="mv-suggest-count">${row.count} раз</div>
            </div>
          </div>`;
        })
        .join('');
      if (!body) return '';
      return `<div class="mv-suggest-block"><div class="mv-suggest-label">Часто в этом месте</div>${body}</div>`;
    }

    function renderRecentBlock(items) {
      if (!items.length) return '';
      const body = items.map((item, index) => resultRowHtml(item, index)).join('');
      return `<div class="mv-suggest-block"><div class="mv-suggest-label">Недавние</div>${body}</div>`;
    }

    function registryAddButtonHtml(query) {
      const q = String(query || '').trim();
      if (!q) return '';
      return `
          <button type="button" class="btn-ghost btn-sm viol-registry-add-btn" id="mvAddToRegistry">
            + Добавить «${AktUtils.escapeHtml(q.slice(0, 60))}» в реестр
          </button>`;
    }

    function renderAddRegistryStrip(query) {
      const btn = registryAddButtonHtml(query);
      if (!btn) return '';
      return `<div class="viol-registry-add-strip">${btn}</div>`;
    }

    function hasStrongRegistryMatch(ranked) {
      return (ranked || []).some((row) => row.full && row.score > 0);
    }

    function renderNotFound(query) {
      return `
          <div class="viol-registry-empty">
            Ничего не подошло в реестре
            <br>
            ${registryAddButtonHtml(query)}
          </div>`;
    }

    function renderBrowse(items) {
      const mesto = currentMestoValue().trim();
      const freq = mesto ? placeStatsForCurrentMesto().top : [];
      const recent = recentRegistryItems(items);
      const list = renderPlainList(ViolationSearch.filterRegistry(items, ''));
      const emptyList = `<div class="viol-registry-empty">Реестр нарушений пуст</div>`;
      if (!freq.length && !recent.length) return list || emptyList;
      const main = list || emptyList;
      return `${renderFreqBlock(freq)}${renderRecentBlock(recent)}<div class="mv-registry-list-section">${main}</div>`;
    }

    function renderRanked(ranked) {
      const leader = ViolationSearch.shouldShowLeader(ranked)
        ? (() => {
            const ds = registryRowDataset(ranked[0].item);
            return `<div class="mv-leader-card" data-reg-id="${AktUtils.escapeHtml(ds.id)}" data-reg-number="${AktUtils.escapeHtml(ds.number)}" data-reg-title="${AktUtils.escapeHtml(ds.titleKey)}">
            <div class="mv-suggest-label">Наиболее подходящее</div>
            <div class="vr-result-title">${AktUtils.escapeHtml(ranked[0].item.title || '')}${alreadyBadge(ranked[0].item.title)}</div>
            <div class="mv-suggest-count">${AktUtils.escapeHtml(ranked[0].reasons.length ? ranked[0].reasons.join(' · ') : 'точное совпадение')}</div>
            <div class="mv-leader-actions">
              <button type="button" class="btn-primary btn-sm" data-leader-apply>Подставить</button>
            </div>
          </div>`;
          })()
        : '';
      const rows = ranked
        .map((row, index) => {
          const extra = row.full
            ? ''
            : `<div class="mv-suggest-count">совпало ${row.matched} из ${row.required}</div>`;
          return resultRowHtml(row.item, index, extra);
        })
        .join('');
      return leader + rows;
    }

    function renderRegistryResults(query) {
      const items = getRegistryItems();
      const q = String(query ?? '');
      if (isBrowseQuery(q)) return renderBrowse(items);
      const mesto = currentMestoValue().trim();
      const placeCounts = mesto ? placeStatsForCurrentMesto().counts : {};
      const result = ViolationSearch.suggestRegistry(items, q, { placeCounts });
      const addStrip = renderAddRegistryStrip(q);
      if (!result.ranked.length) return renderNotFound(q);
      if (!hasStrongRegistryMatch(result.ranked) && q.trim().length >= 2) {
        return `${renderNotFound(q)}${renderRanked(result.ranked)}`;
      }
      return renderRanked(result.ranked) + addStrip;
    }

    function openRegistryAddForm() {
      const q = document.getElementById('mvRegistrySearch')?.value?.trim() || '';
      openAddToRegistryForm(q, renderRegistryResults, bindRegistryResultClicks);
    }

    const ph = violationId == null ? MV_PLACEHOLDER_NEW : MV_PLACEHOLDER_EDIT;

    const body = `
      <div class="form-group mv-mesto-block">
        <label class="form-label">Место нарушения</label>
        <div class="mv-mesto-field">
          <input class="form-control" id="mvMesto"
            name="gazprom-violation-mesto"
            value="${AktUtils.escapeHtml(v?.mesto || '')}"
            placeholder="Введите место нарушения…"
            role="combobox"
            aria-expanded="false"
            aria-controls="mvMestoSuggestions"
            aria-autocomplete="list"
            autocomplete="off">
          <div class="mesto-suggestions" id="mvMestoSuggestions" hidden></div>
        </div>
      </div>

      <div class="mv-search-block form-group">
        <label class="form-label">Нарушение</label>
        <div class="mv-search-row">
          <input type="search"
            class="form-control mv-search-block-input"
            id="mvRegistrySearch"
            placeholder="Начните вводить формулировку нарушения…"
            autocomplete="off"
            value="">
          ${
            VIOLATION_REGISTRY_PHOTO_HINTS
              ? `<button type="button" class="mv-search-camera" id="mvRegistryCamera" aria-label="Добавить фото с камеры или из галереи" title="Камера или галерея">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </button>
          <input type="file" id="mvRegistryCameraInput" class="gazprom-file-input" accept="image/*,.heic,.heif" tabindex="-1" aria-hidden="true">`
              : ''
          }
        </div>
        ${VIOLATION_REGISTRY_PHOTO_HINTS ? '<div id="mvPhotoHints" class="mv-photo-hints" hidden></div>' : ''}
        <div class="viol-registry-results" id="mvRegistryResults">
          ${renderRegistryResults('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Формулировка нарушения <span style="color:var(--danger)">*</span></label>
        <textarea class="form-control mv-auto-textarea" id="mvTitle" rows="1" data-no-capitalize placeholder="${AktUtils.escapeHtml(ph.title)}">${AktUtils.escapeHtml(v?.title || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Вид нарушения <span style="color:var(--danger)">*</span></label>
        <select class="form-control" id="mvVid" required aria-required="true"><option value="">— не выбрано —</option>${vidOpts}</select>
        ${!vidTitles.length ? '<p class="form-hint" style="margin-top:6px;font-size:12px;color:var(--text-muted)">Новые виды — в Настройки → Виды нарушений. При сохранении привязка запишется в реестр для всех актов.</p>' : ''}
      </div>
      <div class="form-group">
        <label class="form-label">Пункт / ссылка на правило</label>
        <textarea class="form-control mv-auto-textarea" id="mvUrl" rows="1" data-no-capitalize placeholder="${AktUtils.escapeHtml(ph.url)}">${AktUtils.escapeHtml(v?.urlToPravilo || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Формулировка из правил</label>
        <textarea class="form-control mv-auto-textarea" id="mvFormula" rows="1" data-no-capitalize placeholder="${AktUtils.escapeHtml(ph.formula)}">${AktUtils.escapeHtml(v?.formulaFromRules || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Фотофиксация</label>
        <div class="photo-grid" id="mvPhotoGrid">${renderModalPhotos()}</div>
      </div>
    `;

    const footer = `
      ${violationId ? '<button type="button" class="btn-ghost modal-btn-danger" id="mvDelete">Удалить</button>' : ''}
      <button type="button" class="btn-primary" id="mvSave">Сохранить</button>
      <button type="button" class="btn-ghost" data-close>Отмена</button>
    `;

    open(violationId ? 'Редактирование нарушения' : 'Новое нарушение', body, footer);
    linkedRegistryItemId = null;
    if (v?.vid) applyViolationVidSelect(v.vid);
    violationFormInitial = readViolationFormSnapshot();

    // Track the registry item that was last selected to detect manual edits
    let selectedRegistryItem = null;

    function getFormSnapshot() {
      return {
        title:            readFieldRaw('mvTitle'),
        subTitle:         readFieldRaw('mvUrl'),
        vid:              document.getElementById('mvVid')?.value || '',
        formulaFromRules: readFieldRaw('mvFormula'),
      };
    }

    function registryTextBaseline() {
      if (selectedRegistryItem) {
        return {
          title: selectedRegistryItem.title || '',
          subTitle: selectedRegistryItem.subTitle || '',
          formulaFromRules: selectedRegistryItem.formulaFromRules || '',
        };
      }
      return {
        title: violationFormInitial?.title || '',
        subTitle: violationFormInitial?.subTitle || '',
        formulaFromRules: violationFormInitial?.formulaFromRules || '',
      };
    }

    function isRegistryTextChanged() {
      const s = getFormSnapshot();
      const base = registryTextBaseline();
      return (
        s.title !== base.title ||
        s.subTitle !== base.subTitle ||
        s.formulaFromRules !== base.formulaFromRules
      );
    }

    function shouldShowSaveToRegistryHint() {
      if (!readFieldRaw('mvTitle').trim()) return false;
      return isRegistryTextChanged();
    }

    function saveToRegistryHintMessage() {
      return selectedRegistryItem
        ? 'Изменены формулировка, пункт правила или текст из правил'
        : 'Новая запись — сохраните её в реестр';
    }

    function updateSaveToRegistryHint() {
      let hint = document.getElementById('mvSaveToRegistryHint');
      if (shouldShowSaveToRegistryHint()) {
        if (!hint) {
          hint = document.createElement('div');
          hint.id = 'mvSaveToRegistryHint';
          hint.className = 'mv-save-registry-hint';
          hint.innerHTML = `
            <p class="mv-save-registry-hint-text"></p>
            <button type="button" class="btn-sm mv-save-registry-btn" id="mvSaveNewToRegistry">Сохранить в реестр</button>
          `;
          const footer = document.getElementById('modalFooter');
          footer?.parentElement?.insertBefore(hint, footer);
          document.getElementById('mvSaveNewToRegistry')?.addEventListener('click', saveCurrentToRegistry);
        }
        hint.querySelector('.mv-save-registry-hint-text').textContent = saveToRegistryHintMessage();
      } else {
        hint?.remove();
      }
    }

    async function syncVidToRegistryIfLinked() {
      const vid = document.getElementById('mvVid')?.value?.trim();
      if (!vid || isRegistryTextChanged()) return;
      const s = getFormSnapshot();
      let registryId = linkedRegistryItemId;
      if (typeof registryId === 'string' && registryId.startsWith('reg-num:')) {
        registryId = null;
      }
      const linked =
        selectedRegistryItem ||
        resolveRegistryItem(getRegistryItems(), {
          id: registryId || '',
          title: s.title,
          titleKey: registryTitleKey(s.title),
        });
      if (!linked && !registryId) return;
      const catalogForBind = ctx.getCatalog();
      const ok = await ViolationRegistry.bindVidToRegistryItem(catalogForBind, {
        registryId: linked?.id || registryId || null,
        title: s.title,
        subTitle: s.subTitle,
        vid,
      });
      if (!ok) return;
      await ctx.reloadCatalog();
      if (selectedRegistryItem) {
        selectedRegistryItem = { ...selectedRegistryItem, vid };
      }
    }

    async function saveCurrentToRegistry() {
      const s = getFormSnapshot();
      if (!s.title) { GazpromToast.error('Заполните формулировку нарушения'); return; }
      await ViolationRegistry.addItem(s);
      GazpromToast.success('Сохранено в реестр нарушений');
      selectedRegistryItem = null;
      document.getElementById('mvSaveToRegistryHint')?.remove();
      await ctx.reloadCatalog();
    }

    function bindFieldChangeWatchers() {
      ['mvTitle', 'mvUrl', 'mvFormula'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', updateSaveToRegistryHint);
        document.getElementById(id)?.addEventListener('change', updateSaveToRegistryHint);
      });
      document.getElementById('mvVid')?.addEventListener('change', () => {
        updateSaveToRegistryHint();
        void syncVidToRegistryIfLinked();
      });
    }

    const mestoInput = document.getElementById('mvMesto');
    const mestoList = document.getElementById('mvMestoSuggestions');
    let mestoTimer = null;
    let searchTimer = null;

    function showMestoSuggestions() {
      if (!mestoInput || !mestoList) return;
      mestoList.hidden = false;
      mestoInput.setAttribute('aria-expanded', 'true');
      mestoInput.closest('.mv-mesto-block')?.classList.add('mv-mesto-block--open');
      requestAnimationFrame(() => {
        mestoList.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }

    function hideMestoSuggestions() {
      if (!mestoInput || !mestoList) return;
      mestoList.hidden = true;
      mestoInput.setAttribute('aria-expanded', 'false');
      mestoInput.closest('.mv-mesto-block')?.classList.remove('mv-mesto-block--open');
    }

    function refreshMestoSuggestions() {
      if (!mestoInput || !mestoList) return;
      const html = renderMestoSuggestions(mestoInput.value);
      if (!html) {
        mestoList.innerHTML = '';
        hideMestoSuggestions();
        return;
      }
      mestoList.innerHTML = html;
      bindMestoSuggestionClicks();
      showMestoSuggestions();
    }

    function bindMestoSuggestionClicks() {
      mestoList?.querySelectorAll('.mesto-suggestion-item').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
          if (mestoInput) mestoInput.value = btn.dataset.mesto || '';
          hideMestoSuggestions();
          scheduleRegistryRefresh();
        });
      });
    }

    if (mestoInput && mestoList) {
      mestoInput.addEventListener('input', () => {
        invalidatePlaceStatsCache();
        clearTimeout(mestoTimer);
        mestoTimer = setTimeout(refreshMestoSuggestions, 120);
        scheduleRegistryRefresh();
      });
      mestoInput.addEventListener('blur', () => {
        setTimeout(hideMestoSuggestions, 150);
      });
    }

    // Registry search
    function findRegistryItemFromEl(el) {
      if (!el) return null;
      return resolveRegistryItem(getRegistryItems(), {
        id: el.dataset.regId || '',
        number: el.dataset.regNumber,
        titleKey: el.dataset.regTitle || '',
      });
    }

    function refreshRegistryPanel() {
      const results = document.getElementById('mvRegistryResults');
      if (!results) return;
      const query = document.getElementById('mvRegistrySearch')?.value || '';
      results.innerHTML = renderRegistryResults(query);
      bindRegistryResultClicks();
    }

    function scheduleRegistryRefresh() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refreshRegistryPanel, 160);
    }

    function applyRegistryItem(item, sourceEl) {
      if (!item) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();

      const titleEl = document.getElementById('mvTitle');
      const urlEl = document.getElementById('mvUrl');
      const formulaEl = document.getElementById('mvFormula');
      if (titleEl) titleEl.value = item.title || '';
      if (urlEl) urlEl.value = item.subTitle || '';
      const live = ctx.getCatalog?.() || catalog;
      let resolvedItemVid =
        live && typeof ViolationTypes !== 'undefined'
          ? ViolationTypes.resolveVid(live, item.vid)
          : (item.vid || '');
      if (
        typeof ViolationTypes !== 'undefined' &&
        typeof ViolationTypes.isLegacyBuiltinVidTitle === 'function' &&
        ViolationTypes.isLegacyBuiltinVidTitle(resolvedItemVid)
      ) {
        resolvedItemVid = '';
      }
      const vidEl = document.getElementById('mvVid');
      if (vidEl) {
        if (resolvedItemVid && !Array.from(vidEl.options).some((o) => o.value === resolvedItemVid)) {
          const opt = document.createElement('option');
          opt.value = resolvedItemVid;
          opt.textContent = resolvedItemVid;
          vidEl.insertBefore(opt, vidEl.options[1] || null);
        }
        vidEl.value = resolvedItemVid;
      }
      if (formulaEl) formulaEl.value = item.formulaFromRules || '';

      linkedRegistryItemId = item.id || (item.number != null ? `reg-num:${item.number}` : null);
      selectedRegistryItem = { ...item, vid: resolvedItemVid };

      document.querySelectorAll('#mvRegistryResults .viol-registry-result-item').forEach((x) =>
        x.classList.remove('selected')
      );
      sourceEl?.classList?.add('selected');
      document.getElementById('mvSaveToRegistryHint')?.remove();

      rememberRecentRegistryId(item.id || '');
      const searchEl = document.getElementById('mvRegistrySearch');
      if (searchEl) searchEl.value = '';
      refreshRegistryPanel();
      scheduleViolationTextareaResize();
    }

    function bindRegistryResultClicks() {
      const root = document.getElementById('mvRegistryResults');
      if (!root) return;
      root.querySelectorAll('.viol-registry-result-item, .mv-leader-card').forEach((el) => {
        el.addEventListener('click', () => {
          if (el.dataset.freqOnly) {
            const picked =
              findRegistryItemFromEl(el) ||
              registryItemForUserTitle(el.dataset.freqOnly);
            if (picked) {
              applyRegistryItem(picked, el);
              return;
            }
            const titleEl = document.getElementById('mvTitle');
            if (titleEl) titleEl.value = el.dataset.freqOnly;
            updateSaveToRegistryHint();
            scheduleViolationTextareaResize();
            return;
          }
          const picked = findRegistryItemFromEl(el);
          if (picked) applyRegistryItem(picked, el);
          else if (el.dataset.regTitle) {
            GazpromToast.info('Запись в реестре не найдена. Введите формулировку вручную.');
          }
        });
      });
      root.querySelectorAll('[data-leader-apply]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const card = btn.closest('.mv-leader-card');
          const picked = findRegistryItemFromEl(card);
          if (picked) applyRegistryItem(picked, card);
        });
      });
    }

    function bindRegistryAddDelegation() {
      const root = document.getElementById('mvRegistryResults');
      if (!root || root.dataset.mvAddRegistryBound === '1') return;
      root.dataset.mvAddRegistryBound = '1';
      root.addEventListener('click', (e) => {
        if (!e.target.closest('#mvAddToRegistry, .viol-registry-add-btn')) return;
        e.preventDefault();
        e.stopPropagation();
        openRegistryAddForm();
      });
    }

    function renderPhotoHintList(hints) {
      const el = document.getElementById('mvPhotoHints');
      if (!el) return;
      el.hidden = false;
      el.innerHTML = `
        <div class="mv-photo-hints-head">
          <div class="mv-suggest-label">Похоже на фото</div>
          <button type="button" class="btn-ghost btn-sm" id="mvPhotoHintsReset">Скрыть</button>
        </div>
        ${hints.map((hint) => `
          <button type="button" class="mv-photo-hint" data-reg-id="${AktUtils.escapeHtml(hint.item.id || '')}" data-reg-number="${AktUtils.escapeHtml(hint.item.number ?? '')}">
            <span class="vr-result-title">${AktUtils.escapeHtml(hint.item.title || '')}${alreadyBadge(hint.item.title)}</span>
            <span class="mv-suggest-count">${hint.percent}%</span>
          </button>
        `).join('')}
      `;
      bindPhotoHintDismiss(el);
      el.querySelectorAll('.mv-photo-hint').forEach((btn) => {
        btn.addEventListener('click', () => {
          const picked = findRegistryItemFromEl(btn);
          if (picked) applyRegistryItem(picked, btn);
        });
      });
    }

    function showPhotoHintMessage(message) {
      const el = document.getElementById('mvPhotoHints');
      if (!el) return;
      el.hidden = false;
      el.innerHTML = `
        <div class="mv-photo-hints-head">
          <div class="mv-suggest-label">Похоже на фото</div>
          <button type="button" class="btn-ghost btn-sm" id="mvPhotoHintsReset">Скрыть</button>
        </div>
        <p class="mv-suggest-count mv-photo-hint-empty">${AktUtils.escapeHtml(message)}</p>
      `;
      bindPhotoHintDismiss(el);
    }

    async function explainEmptyPhotoHints(preds) {
      try {
        if (typeof MlImageService?.getStatistics === 'function') {
          const stats = await MlImageService.getStatistics({ skipAccuracy: true });
          if ((stats?.totalPhotos || 0) === 0) {
            return (
              'Модель по фото ещё не обучена: Настройки → Обучение модели. ' +
              'Загрузите снимки по видам нарушений или подтяните фото из актов. ' +
              'Пока выбирайте формулировку текстом в строке поиска выше.'
            );
          }
        }
      } catch {
        /* подсказка по тексту ниже */
      }
      if (!preds?.length) {
        return 'Не удалось проанализировать снимок. Попробуйте другое фото или введите формулировку текстом.';
      }
      return 'Уверенных совпадений с реестром нет. Выберите вариант в списке ниже или введите свой текст.';
    }

    async function runPhotoHint(ref) {
      if (photoHintsDismissed || !ref) return;
      const gen = ++photoHintGen;
      const box = document.getElementById('mvPhotoHints');
      if (box) {
        box.hidden = false;
        box.innerHTML = `
          <div class="mv-suggest-label">Похоже на фото</div>
          <p class="mv-suggest-count">Смотрим фото…</p>
        `;
      }
      try {
        const src = typeof AktUtils?.photoSrcAsync === 'function' ? await AktUtils.photoSrcAsync(ref) : '';
        if (gen !== photoHintGen || photoHintsDismissed) return;
        if (!src) {
          showPhotoHintMessage('Не удалось прочитать снимок. Попробуйте добавить фото ещё раз.');
          return;
        }
        if (typeof MlImageService === 'undefined' || typeof MlImageService.predict !== 'function') {
          showPhotoHintMessage('Подсказки по фото недоступны. Обновите страницу или выберите нарушение текстом.');
          return;
        }
        const preds = await MlImageService.predict(src);
        if (gen !== photoHintGen || photoHintsDismissed) return;
        const hints = ViolationSearch.mapPhotoHints(Array.isArray(preds) ? preds : [], getRegistryItems());
        if (gen !== photoHintGen || photoHintsDismissed) return;
        if (!hints.length) {
          showPhotoHintMessage(await explainEmptyPhotoHints(preds));
          return;
        }
        renderPhotoHintList(hints);
      } catch {
        if (gen === photoHintGen) {
          showPhotoHintMessage('Ошибка при анализе фото. Выберите формулировку вручную.');
        }
      }
    }

    if (VIOLATION_REGISTRY_PHOTO_HINTS) {
      photoPickHintHandler = (added) => {
        if (!added?.length) return;
        photoHintsDismissed = false;
        void runPhotoHint(added[added.length - 1]);
      };
    }

    document.getElementById('mvRegistrySearch')?.addEventListener('input', () => {
      scheduleRegistryRefresh();
    });

    if (VIOLATION_REGISTRY_PHOTO_HINTS) {
      const cameraBtn = document.getElementById('mvRegistryCamera');
      const cameraInput = document.getElementById('mvRegistryCameraInput');
      cameraBtn?.addEventListener('click', () => {
        GazpromFileUtils?.triggerFilePicker?.(cameraInput);
      });
      cameraInput?.addEventListener('change', async (e) => {
        const added = await onPhotoPick(e);
        photoPickHintHandler?.(added);
      });
    }

    bindRegistryResultClicks();
    bindRegistryAddDelegation();
    bindFieldChangeWatchers();

    // Bind input listeners
    ['mvTitle', 'mvUrl', 'mvFormula'].forEach((id) => {
      bindAutoResize(document.getElementById(id));
    });

    // After layout — resize all textareas to fit pre-filled content
    setTimeout(scheduleViolationTextareaResize, 50);

    document.getElementById('mvSave')?.addEventListener('click', saveViolation);
    document.getElementById('mvDelete')?.addEventListener('click', deleteViolation);
    if (VIOLATION_REGISTRY_PHOTO_HINTS && modalPhotos.length) void runPhotoHint(modalPhotos[0]);
    bindModalPhotoClicks();
    hydrateModalPhotoThumbs();
  }

  function renderModalPhotos() {
    const thumbs = modalPhotos
      .map(
        (p, i) => `
      <div class="photo-slot filled wizard-photo-thumb mv-photo-item" data-pidx="${i}">
        <img src="" data-photo-idx="${i}" alt="">
        <button type="button" class="photo-remove" data-rm="${i}">×</button>
      </div>`
      )
      .join('');
    // Always append the "add" slot at the end
    const addSlot = `<div class="photo-slot wizard-photo-add mv-photo-add-slot" title="Добавить фото">+</div>`;
    return thumbs + addSlot;
  }

  function bindModalPhotoClicks() {
    document.querySelectorAll('#mvPhotoGrid .photo-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        modalPhotos.splice(parseInt(btn.dataset.rm, 10), 1);
        document.getElementById('mvPhotoGrid').innerHTML = renderModalPhotos();
        bindModalPhotoClicks();
        hydrateModalPhotoThumbs();
        if (!modalPhotos.length) afterModalPhotosCleared?.();
      });
    });
    document.querySelectorAll('#mvPhotoGrid .mv-photo-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('photo-remove')) return;
        const i = parseInt(el.dataset.pidx, 10);
        if (modalPhotos[i]) {
          Promise.all(modalPhotos.map((p) => AktUtils.photoSrcAsync(p))).then((urls) => {
            const g = urls.filter(Boolean);
            if (g.length) ctx.openLightbox(g[i], g);
          });
        }
      });
    });
    document.querySelector('#mvPhotoGrid .mv-photo-add-slot')?.addEventListener('click', () => {
      GazpromFileUtils?.triggerFilePicker?.(document.getElementById('mvPhotoInput'));
    });
  }

  async function onPhotoPick(e) {
    const files = [...(e.target.files || [])];
    const added = [];
    const maxInputBytes = 40 * 1024 * 1024;
    for (const file of files) {
      const isImage =
        typeof GazpromFileUtils !== 'undefined'
          ? GazpromFileUtils.isImageFile(file)
          : file.type.startsWith('image/');
      if (!isImage) continue;
      if (file.size > maxInputBytes) {
        GazpromToast.error(`Файл ${file.name} слишком большой (макс. 40 МБ)`);
        continue;
      }
      try {
        if (file.size > 2 * 1024 * 1024) {
          GazpromToast.show('Сжимаем фото…', 'info', 2000);
        }
        const b64 =
          typeof PhotoStore?.fileToViolationBase64 === 'function'
            ? await PhotoStore.fileToViolationBase64(file)
            : await fileToBase64(file);
        if (!b64) continue;
        if (typeof PhotoStore?.ingestPhotoRef === 'function') {
          const result = await PhotoStore.ingestPhotoRef(b64);
          if (result?.id) {
            modalPhotos.push(result.id);
            added.push(result.id);
          } else GazpromToast.error(`Не удалось сохранить фото ${file.name}`);
        } else {
          modalPhotos.push(b64);
          added.push(b64);
        }
      } catch {
        GazpromToast.error(`Не удалось обработать ${file.name}`);
      }
    }
    const grid = document.getElementById('mvPhotoGrid');
    if (grid) {
      grid.innerHTML = renderModalPhotos();
      bindModalPhotoClicks();
      hydrateModalPhotoThumbs();
    }
    if (e?.target) e.target.value = '';
    return added;
  }

  async function hydrateModalPhotoThumbs() {
    document.querySelectorAll('#mvPhotoGrid img[data-photo-idx]').forEach(async (img) => {
      const i = parseInt(img.dataset.photoIdx, 10);
      const src = await AktUtils.photoSrcAsync(modalPhotos[i]);
      if (src) img.src = src;
    });
  }

  async function saveViolation() {
    if (savingViolation) {
      GazpromToast.info('Сохранение уже выполняется…');
      return;
    }

    const title = readFieldRaw('mvTitle');
    if (isBlankText(title)) {
      GazpromToast.error('Укажите формулировку нарушения');
      return;
    }

    const vidFromSelect = document.getElementById('mvVid')?.value?.trim() || '';
    if (!vidFromSelect) {
      GazpromToast.error('Выберите вид нарушения');
      return;
    }

    const saveBtn = document.getElementById('mvSave');
    if (saveBtn && !saveBtn.dataset.defaultLabel) {
      saveBtn.dataset.defaultLabel = saveBtn.textContent || 'Сохранить';
    }

    savingViolation = true;
    window.__gazpromSavingViolation = true;
    setSaveButtonsBusy(true);

    const violationId = editingViolationId || AktUtils.uuid();
    const prevCount = (ctx.getDraft()?.violations || []).length;
    const wasEditing = !!editingViolationId;

    try {
      await withSaveTimeout((async () => {
        const mesto = readFieldRaw('mvMesto');
        const prevViolation = editingViolationId
          ? (ctx.getDraft()?.violations || []).find((x) => x.id === editingViolationId)
          : null;
        const vid = vidFromSelect;
        const urlToPravilo = readFieldRaw('mvUrl');
        const formulaRaw = readFieldRaw('mvFormula');
        const formulaFromRules = formulaRaw !== '' ? formulaRaw : null;

        const photoRefs = await finalizePhotoRefs(modalPhotos);

        const draft = ctx.getDraft();
        if (!draft) throw new Error('Черновик акта недоступен');

        const payload = {
          ...(prevViolation || {}),
          id: violationId,
          title,
          mesto,
          urlToPravilo,
          photo: photoRefs,
          vid,
          formulaFromRules: formulaRaw !== '' ? formulaRaw : null,
        };

        if (editingViolationId) {
          draft.violations = (draft.violations || []).map((x) =>
            x.id === editingViolationId ? payload : x
          );
        } else {
          draft.violations = [...(draft.violations || []), payload];
        }

        ctx.setDraft(draft);
        await ctx.saveDraft();

        if (vid) {
          const catalogForBind = ctx.getCatalog();
          await ViolationRegistry.bindVidToRegistryItem(catalogForBind, {
            registryId: linkedRegistryItemId,
            title,
            subTitle: urlToPravilo,
            vid,
          });
          await ctx.reloadCatalog();
        }

        const saved = (ctx.getDraft()?.violations || []).find((x) => x.id === violationId);
        if (!saved) {
          throw new Error('Нарушение не записалось в черновик');
        }
        if (!editingViolationId && (ctx.getDraft()?.violations || []).length <= prevCount) {
          throw new Error('Нарушение не добавилось в список');
        }
      })());

      const onUpdate = ctx.onUpdate;
      finishViolationSave(onUpdate);
      GazpromToast.success(wasEditing ? 'Нарушение сохранено' : 'Нарушение добавлено');
    } catch (err) {
      console.error(err);
      GazpromToast.error(
        err?.message || 'Не удалось сохранить нарушение. Попробуйте ещё раз.'
      );
    } finally {
      if (document.getElementById('wizardModalRoot')?.classList.contains('show')) {
        savingViolation = false;
        window.__gazpromSavingViolation = false;
        setSaveButtonsBusy(false);
      }
    }
  }

  function deleteViolation() {
    if (!editingViolationId) return;
    GazpromToast.confirm('Удалить это нарушение?').then((ok) => {
      if (!ok) return;
      doDeleteViolation();
    });
    return;
  }

  async function doDeleteViolation() {
    try {
      const draft = ctx.getDraft();
      draft.violations = (draft.violations || []).filter((x) => x.id !== editingViolationId);
      ctx.setDraft(draft);
      await ctx.saveDraft();
      finishViolationSave(ctx.onUpdate);
    } catch (err) {
      console.error(err);
      GazpromToast.error(err?.message || 'Не удалось удалить нарушение');
    }
  }

  function openQuickAdd(type) {
    const forms = {
      org: {
        title: 'Новая организация',
        html: `
          <div class="form-group"><label>Наименование</label><input class="form-control" id="qaTitle" placeholder="Например: ООО «Газпром трансгаз»"></div>
          <div class="form-group"><label>Краткое название</label><input class="form-control" id="qaSub" placeholder="Например: КДТГ"></div>
        `,
        save: async () => {
          const title = document.getElementById('qaTitle')?.value?.trim();
          if (!title) { GazpromToast.error('Укажите наименование'); return; }
          const sub = document.getElementById('qaSub')?.value?.trim();
          return CatalogService.addOrganization(title, sub);
        },
      },
      object: {
        title: 'Новый объект',
        html: `
          <div class="form-group"><label>Название объекта</label><input class="form-control" id="qaTitle" placeholder="Например: КС Краснодарская"></div>
          <div class="form-group"><label>Адрес / примечание</label><input class="form-control" id="qaSub" placeholder="Например: ул. Ленина, 1"></div>
        `,
        save: async () => {
          const title = document.getElementById('qaTitle')?.value?.trim();
          if (!title) { GazpromToast.error('Укажите название'); return; }
          const sub = document.getElementById('qaSub')?.value?.trim();
          return CatalogService.addObject(title, sub);
        },
      },
      commission: {
        title: 'Новый член комиссии',
        html: `
          <div class="form-group"><label>ФИО</label><input class="form-control" id="qaTitle" placeholder="Например: И. И. Иванов" autocomplete="off"></div>
          <div class="form-group"><label>Должность</label><input class="form-control" id="qaSub" placeholder="Например: Начальник участка"></div>
        `,
        save: async () => {
          const fioInput = document.getElementById('qaTitle');
          const fio = AktUtils.normalizeRepresentativeFio(fioInput?.value || '');
          if (fioInput) fioInput.value = fio;
          if (!fio) { GazpromToast.error('Укажите ФИО'); return; }
          const job = document.getElementById('qaSub')?.value?.trim();
          return CatalogService.addCommissionPerson(fio, job);
        },
      },
      pred: {
        title: 'Новый представитель',
        html: `
          <div class="form-group"><label>ФИО</label><input class="form-control" id="qaTitle" placeholder="Например: И. И. Иванов" autocomplete="off"></div>
          <div class="form-group"><label>Должность</label>
            <div class="field-suggest-wrap">
              <input class="form-control" id="qaSub" placeholder="Например: Главный инженер" autocomplete="off">
              <div class="mesto-suggestions" id="qaSubSuggestions" hidden></div>
            </div>
          </div>
          <div class="form-group"><label>Организация</label>
            <div class="field-suggest-wrap">
              <input class="form-control" id="qaOrg" value="${AktUtils.escapeHtml(ctx.getDraft().organization?.title || '')}" autocomplete="off">
              <div class="mesto-suggestions" id="qaOrgSuggestions" hidden></div>
            </div>
          </div>
        `,
        save: async () => {
          const fioInput = document.getElementById('qaTitle');
          const fio = AktUtils.normalizeRepresentativeFio(fioInput?.value || '');
          if (fioInput) fioInput.value = fio;
          if (!fio) { GazpromToast.error('Укажите ФИО'); return; }
          const job = document.getElementById('qaSub')?.value?.trim();
          const org = document.getElementById('qaOrg')?.value?.trim();
          return CatalogService.addPredstavitely(fio, job, org);
        },
      },
    };

    const f = forms[type];
    if (!f) return;

    open(
      f.title,
      f.html,
      `<button type="button" class="btn-ghost" data-close>Отмена</button>
       <button type="button" class="btn-primary" id="qaSave">Добавить</button>`
    );

    if (type === 'commission') {
      AktUtils.bindRepresentativeFioInput(document.getElementById('qaTitle'));
    }

    if (type === 'pred') {
      AktUtils.bindRepresentativeFioInput(document.getElementById('qaTitle'));
      const catalog = typeof ctx.getCatalog === 'function' ? ctx.getCatalog() : null;
      const jobInput = document.getElementById('qaSub');
      const jobList = document.getElementById('qaSubSuggestions');
      if (jobInput && jobList) {
        AktUtils.bindFieldSuggestions(jobInput, jobList, () => {
          const c = typeof ctx.getCatalog === 'function' ? ctx.getCatalog() : catalog;
          return AktUtils.collectJobTitleSuggestions(c);
        });
      }
      const orgInput = document.getElementById('qaOrg');
      const orgList = document.getElementById('qaOrgSuggestions');
      if (orgInput && orgList) {
        AktUtils.bindFieldSuggestions(orgInput, orgList, () => {
          const c = typeof ctx.getCatalog === 'function' ? ctx.getCatalog() : catalog;
          return AktUtils.collectOrganizationSuggestions(c);
        });
      }
    }

    document.getElementById('qaSave')?.addEventListener('click', async () => {
      const item = await f.save();
      if (!item) return;
      await ctx.reloadCatalog();
      close();
      ctx.onQuickAdd(type, item);
    });
  }

  function openAddToRegistryForm(prefillTitle, renderRegistryResults, bindRegistryResultClicks) {
    const catalog = ctx.getCatalog();
    const registryItems = catalog?.violationRegistry || [];
    const maxNum = Math.max(0, ...registryItems.map((x) => x.number || 0));
    const nextNum = maxNum + 1;

    // Unique subTitle values for datalist autocomplete
    const uniqueSubTitles = [...new Set(registryItems.map((x) => x.subTitle).filter(Boolean))];
    const subTitleDatalist = uniqueSubTitles
      .map((s) => `<option value="${AktUtils.escapeHtml(s)}">`)
      .join('');

    const vidTitles =
      catalog && typeof ViolationTypes !== 'undefined'
        ? ViolationTypes.getVidSelectTitles(catalog, '')
        : [];
    const vidOpts = vidTitles
      .map((t) => `<option value="${AktUtils.escapeHtml(t)}">${AktUtils.escapeHtml(t)}</option>`)
      .join('');

    // Registry items for the rule picker — unique subTitle entries, show only пункт правила
    const seenSubTitles = new Set();
    const rulePickerItems = registryItems
      .filter((r) => r.subTitle && !seenSubTitles.has(r.subTitle) && seenSubTitles.add(r.subTitle))
      .map(
        (r) => `
        <div class="arv-rule-pick-item"
          data-rule-subtitle="${AktUtils.escapeHtml(r.subTitle || '')}"
          data-rule-formula="${AktUtils.escapeHtml(r.formulaFromRules || '')}"
          data-rule-vid="${AktUtils.escapeHtml(r.vid || '')}">
          <div class="arv-rule-sub">📄 ${AktUtils.escapeHtml(r.subTitle)}</div>
          ${r.formulaFromRules ? `<div class="arv-rule-formula">${AktUtils.escapeHtml(r.formulaFromRules.slice(0, 80))}${r.formulaFromRules.length > 80 ? '…' : ''}</div>` : ''}
        </div>`
      )
      .join('');

    const overlay = document.createElement('div');
    overlay.className = 'vr-form-overlay vr-form-overlay--wizard';
    overlay.innerHTML = `
      <div class="vr-form-dialog card">
        <h3>Добавить нарушение в реестр</h3>

        <div class="form-group">
          <label class="form-label">Номер нарушения</label>
          <input class="form-control" id="arvNumber" type="number" min="1" value="${nextNum}" style="max-width:120px">
        </div>

        <div class="form-group">
          <label class="form-label">Формулировка нарушения <span style="color:var(--danger)">*</span></label>
          <textarea class="form-control" id="arvTitle" rows="3"
            placeholder="Не проведён инструктаж по охране труда…">${AktUtils.escapeHtml(prefillTitle)}</textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Пункт / ссылка на правило</label>
          <input class="form-control" id="arvSubTitle" list="arvSubTitleList"
            placeholder="п. 4.1 СП 12-135-2003" autocomplete="off" data-no-capitalize>
          <datalist id="arvSubTitleList">${subTitleDatalist}</datalist>
          ${rulePickerItems ? `
          <button type="button" class="btn-ghost btn-sm arv-pick-btn" id="arvPickRule"
            style="margin-top:6px;width:100%;text-align:left;">
            📋 Выбрать из реестра
          </button>
          <div id="arvRulePicker" hidden class="arv-rule-picker">
            <input type="search" class="form-control arv-rule-search" placeholder="Поиск по пункту правила…"
              style="margin-bottom:6px" autocomplete="off">
            <div class="arv-rule-picker-list">${rulePickerItems}</div>
          </div>` : ''}
        </div>

        <div class="form-group">
          <label class="form-label">Формулировка из правил</label>
          <textarea class="form-control" id="arvFormulaFromRules" rows="2"
            placeholder="Согласно п. …"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Примечание</label>
          <input class="form-control" id="arvDescription" placeholder="Доп. информация">
        </div>

        <div class="form-group">
          <label class="form-label">Вид нарушения</label>
          <select class="form-control" id="arvVid">
            <option value="">— не выбрано —</option>
            ${vidOpts}
          </select>
        </div>

        <div class="catalog-form-actions">
          <button type="button" class="btn-ghost" id="arvCancel">Отмена</button>
          <button type="button" class="btn-primary" id="arvSave">Добавить в реестр</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Auto-resize textareas to fit content while keeping manual resize
    function autoResize(el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
    overlay.querySelectorAll('textarea').forEach((ta) => {
      ta.style.resize = 'vertical';
      ta.style.overflow = 'hidden';
      autoResize(ta);
      ta.addEventListener('input', () => autoResize(ta));
    });

    setTimeout(() => overlay.querySelector('#arvTitle')?.focus(), 50);

    const remove = () => overlay.remove();
    overlay.querySelector('#arvCancel').onclick = remove;
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') remove(); });

    // Toggle rule picker visibility
    overlay.querySelector('#arvPickRule')?.addEventListener('click', () => {
      const picker = overlay.querySelector('#arvRulePicker');
      if (picker) {
        picker.hidden = !picker.hidden;
        if (!picker.hidden) picker.querySelector('.arv-rule-search')?.focus();
      }
    });

    // Filter rule picker list on search input
    overlay.querySelector('.arv-rule-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      overlay.querySelectorAll('.arv-rule-pick-item').forEach((el) => {
        const text = el.textContent.toLowerCase();
        el.hidden = q ? !text.includes(q) : false;
      });
    });

    // Select rule from picker — fills subTitle and formulaFromRules fields
    overlay.querySelectorAll('.arv-rule-pick-item').forEach((el) => {
      el.addEventListener('click', () => {
        const subTitleInput = overlay.querySelector('#arvSubTitle');
        if (subTitleInput) subTitleInput.value = el.dataset.ruleSubtitle || '';
        const formulaInput = overlay.querySelector('#arvFormulaFromRules');
        if (formulaInput && el.dataset.ruleFormula) {
          formulaInput.value = el.dataset.ruleFormula;
          autoResize(formulaInput);
        }
        const vidSelect = overlay.querySelector('#arvVid');
        if (vidSelect && el.dataset.ruleVid) vidSelect.value = el.dataset.ruleVid;
        const picker = overlay.querySelector('#arvRulePicker');
        if (picker) picker.hidden = true;
      });
    });

    // Save to registry
    overlay.querySelector('#arvSave').onclick = async () => {
      const title = overlay.querySelector('#arvTitle')?.value?.trim();
      if (!title) { GazpromToast.error('Укажите формулировку нарушения'); return; }

      const number = parseInt(overlay.querySelector('#arvNumber')?.value, 10) || nextNum;
      const subTitle = overlay.querySelector('#arvSubTitle')?.value?.trim() || '';
      const formulaFromRules = overlay.querySelector('#arvFormulaFromRules')?.value?.trim() || '';
      const description = overlay.querySelector('#arvDescription')?.value?.trim() || '';
      const vid = overlay.querySelector('#arvVid')?.value || '';

      await ViolationRegistry.addItem({ number, title, subTitle, formulaFromRules, description, vid });
      GazpromToast.success('Добавлено в реестр нарушений');
      remove();

      await ctx.reloadCatalog();

      // Pre-fill violation title field if it's empty
      const titleEl = document.getElementById('mvTitle');
      if (titleEl && !titleEl.value) {
        titleEl.value = title;
        scheduleViolationTextareaResize();
      }
      const vidEl = document.getElementById('mvVid');
      if (vidEl && vid) vidEl.value = vid;

      // Clear search and refresh registry results in violation editor
      const searchEl = document.getElementById('mvRegistrySearch');
      if (searchEl) searchEl.value = '';
      const results = document.getElementById('mvRegistryResults');
      if (results && renderRegistryResults && bindRegistryResultClicks) {
        const searchVal = searchEl?.value?.trim() || title;
        results.innerHTML = renderRegistryResults(searchVal);
        bindRegistryResultClicks();
      }
    };
  }

  return { init, open, close, openViolationEditor, openQuickAdd, isSavingViolation };
})();
