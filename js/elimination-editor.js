/**
 * Устранение нарушений — UI и логика как в iOS (список по актам, статистика, детальная карточка).
 */
const EliminationEditor = (() => {
  let selectedYear = null;
  let selectedFilter = 'all';
  let detailState = null;
  let persistTimer = null;

  const RING_R = 28;
  const RING_C = 2 * Math.PI * RING_R;
  const RING_CX = 34;

  function schedulePersist(catalog) {
    GazpromStore.updateCache(catalog);
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void GazpromStore.set(catalog);
    }, 250);
  }

  async function flushPersist() {
    if (!persistTimer) return;
    clearTimeout(persistTimer);
    persistTimer = null;
    const data = await GazpromStore.get();
    await GazpromStore.set(data);
  }

  function refreshEliminationLight(catalog, aktId = null) {
    const items = buildEliminationItems(catalog);
    renderStats(items);
    renderDonut(computeStats(items));
    if (aktId) {
      patchActCard(aktId, items);
    } else {
      renderCardList(applyStatusFilter(items));
    }
  }

  function actIsDone(item) {
    return item.totalViolations === 0 || item.allEliminated;
  }

  function actIsOpen(item) {
    return item.totalViolations > 0 && !item.allEliminated;
  }

  function actIsOverdue(item) {
    if (!actIsOpen(item)) return false;
    const deadline =
      item.earliestDeadline || AktUtils.getEliminationDeadline(item.akt);
    return AktUtils.isDeadlineExpired(deadline);
  }

  function actIsInWork(item) {
    return actIsOpen(item) && !item.hasOverdue;
  }

  function applyStatusFilter(items) {
    if (selectedFilter === 'overdue' || selectedFilter === 'open') {
      return items.filter(actIsOverdue);
    }
    if (selectedFilter === 'done') {
      return items.filter(actIsDone);
    }
    if (selectedFilter === 'inwork') {
      return items.filter(actIsInWork);
    }
    return items;
  }

  function ringMetrics(eliminated, total) {
    if (total <= 0) {
      return { dash: `0 ${RING_C}`, label: '—', pct: 0 };
    }
    const pct = Math.min(100, Math.round((eliminated / total) * 100));
    const filled = (RING_C * eliminated) / total;
    return {
      dash: `${filled} ${RING_C - filled}`,
      label: `${pct}%`,
      pct,
    };
  }

  function buildStatusLineHtml(overdue, noViolations) {
    if (noViolations) {
      return '<p class="elimination-act-card__status-line elimination-act-card__status-line--muted">Нарушения отсутствуют</p>';
    }
    if (overdue) {
      return '<p class="elimination-act-card__status-line"><span class="elimination-act-card__status-line--overdue">Просрочено</span></p>';
    }
    return '';
  }

  function buildActHeaderHtml(aktNumber, akt, item, noViolations) {
    const orgName = akt.organization?.shortTitle || akt.organization?.title || '—';
    const orgHtml = `<span class="elimination-act-card__org">${AktUtils.escapeHtml(orgName)}</span>`;
    let deadlineHtml = '';
    if (!noViolations) {
      if (item.earliestDeadline) {
        const dl = AktUtils.formatDateShort(item.earliestDeadline);
        deadlineHtml = `<span class="elimination-act-card__deadline">Срок: ${AktUtils.escapeHtml(dl)}</span>`;
      } else {
        deadlineHtml =
          '<span class="elimination-act-card__deadline elimination-act-card__deadline--unset">Срок не установлен</span>';
      }
    }
    return `<div class="elimination-act-card__head">
      <h4 class="elimination-act-card__title">Акт №${AktUtils.escapeHtml(aktNumber)}</h4>
      ${orgHtml}
      ${deadlineHtml}
    </div>`;
  }

  function buildObjectHtml(akt) {
    const objectTitle = (akt.objectsCheck || [])[0]?.title || '';
    if (!objectTitle) return '';
    return `<p class="elimination-act-card__object">${AktUtils.escapeHtml(objectTitle)}</p>`;
  }

  function buildToggleBtnHtml(item, allDone, overdue, noViolations) {
    if (noViolations) {
      return '<span class="elimination-act-card__pill elimination-act-card__pill--muted">—</span>';
    }
    const label = allDone ? 'Устранено' : 'Не устранено';
    const title = allDone
      ? 'Снять отметки устранения по акту'
      : 'Отметить все нарушения акта устранёнными';
    const cls = [
      'elimination-act-card__toggle',
      allDone ? 'elimination-act-card__toggle--done' : 'elimination-act-card__toggle--open',
      !allDone && overdue ? 'elimination-act-card__toggle--overdue' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<button type="button" class="${cls}" data-elim-toggle="${AktUtils.escapeHtml(item.aktId)}" title="${AktUtils.escapeHtml(title)}" aria-label="${AktUtils.escapeHtml(title)}">${AktUtils.escapeHtml(label)}</button>`;
  }

  function patchActCard(aktId, items) {
    const filtered = applyStatusFilter(items);
    const item = items.find((i) => aktIdMatch(i.aktId, aktId));
    const card = document.querySelector(`[data-elim-akt="${CSS.escape(String(aktId))}"]`);
    const inFilter = item && filtered.some((i) => aktIdMatch(i.aktId, aktId));

    if (!item || !inFilter) {
      if (card) card.remove();
      const list = document.getElementById('eliminationCardList');
      if (list && !list.querySelector('[data-elim-akt]')) {
        list.innerHTML = renderCardListHtml([], filterEmptyMessage());
      }
      return;
    }
    if (!card) {
      renderCardList(filtered);
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderCardListHtml([item]);
    const next = wrapper.firstElementChild;
    if (next) card.replaceWith(next);
  }

  function aktIdMatch(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  function eliminationDeadline(el, akt) {
    return AktUtils.getViolationEliminationDeadline(el, akt);
  }

  function isEliminationOverdue(el, akt) {
    return AktUtils.isViolationEliminationOverdue(el, akt);
  }

  function violationsLabel(count) {
    if (count === 1) return 'нарушение';
    return 'нарушений';
  }

  function minDeadline(dates) {
    let min = null;
    for (const iso of dates) {
      if (!iso) continue;
      const t = new Date(iso).getTime();
      if (Number.isNaN(t)) continue;
      if (min == null || t < new Date(min).getTime()) min = iso;
    }
    return min;
  }

  function buildEliminationItems(data, yearFilter = selectedYear) {
    const akts = data.akts || [];
    const allEliminations = data.violationEliminations || [];

    let items = akts.map((akt) => {
      const violations = akt.violations || [];
      const totalViolations = violations.length;
      let eliminatedViolations = 0;
      let overdueCount = 0;
      let onTimeCount = 0;

      const uneliminatedDeadlines = [];
      for (const v of violations) {
        const el = AktUtils.findViolationElimination(allEliminations, akt.id, v.id);
        if (el?.isEliminated) {
          eliminatedViolations += 1;
          continue;
        }
        const deadline = AktUtils.getViolationEliminationDeadline(el, akt);
        if (deadline) uneliminatedDeadlines.push(deadline);
        if (AktUtils.isViolationEliminationOverdue(el, akt)) overdueCount += 1;
        else onTimeCount += 1;
      }

      let earliestDeadline = minDeadline(uneliminatedDeadlines);
      if (!earliestDeadline && totalViolations > 0 && eliminatedViolations < totalViolations) {
        earliestDeadline = AktUtils.getEliminationDeadline(akt);
      }

      const allEliminated =
        totalViolations > 0 && eliminatedViolations === totalViolations;

      const actOpen = totalViolations > 0 && !allEliminated;
      const actOverdue = actOpen && AktUtils.isDeadlineExpired(earliestDeadline);

      const eliminations = violations
        .map((v) => AktUtils.findViolationElimination(allEliminations, akt.id, v.id))
        .filter(Boolean);

      return {
        aktId: akt.id,
        aktNumber: akt.number,
        akt,
        totalViolations,
        eliminatedViolations,
        overdueCount,
        onTimeCount,
        hasOverdue: actOverdue,
        earliestDeadline,
        allEliminated,
        eliminations,
      };
    });

    items.sort(
      (a, b) => (parseInt(a.aktNumber, 10) || 0) - (parseInt(b.aktNumber, 10) || 0)
    );

    if (yearFilter != null) {
      items = items.filter((item) => {
        const d = item.akt?.date;
        if (!d) return false;
        return new Date(d).getFullYear() === yearFilter;
      });
    }

    return items;
  }

  function computeStats(items) {
    return items.reduce(
      (acc, item) => {
        acc.total += item.totalViolations;
        acc.done += item.eliminatedViolations;
        acc.overdue += item.overdueCount;
        acc.onTime += item.onTimeCount;
        return acc;
      },
      { total: 0, done: 0, overdue: 0, onTime: 0 }
    );
  }

  function getAvailableYears(data) {
    const years = new Set();
    (data.akts || []).forEach((a) => {
      if (a.date) years.add(new Date(a.date).getFullYear());
    });
    return [...years].sort((a, b) => b - a);
  }

  function renderStats(items) {
    const total = items.length;
    const done = items.filter(actIsDone).length;
    const inwork = items.filter(actIsInWork).length;
    const overdue = items.filter(actIsOverdue).length;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    set('elimStatTotal', total);
    set('elimStatDone', done);
    set('elimStatInwork', inwork);
    set('elimStatOpen', overdue);
    updateStatFilterActive();
  }

  function updateStatFilterActive() {
    document.querySelectorAll('.elim-stat-grid [data-elim-filter]').forEach((btn) => {
      const filter = btn.dataset.elimFilter;
      const active =
        (filter === 'all' && selectedFilter === 'all') ||
        filter === selectedFilter ||
        (filter === 'open' && selectedFilter === 'overdue');
      btn.classList.toggle('elim-stat-card--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function handleStatusFilter(filter) {
    if (filter === 'all') {
      selectedFilter = 'all';
      return;
    }
    selectedFilter = selectedFilter === filter ? 'all' : filter;
  }

  function renderDonut(stats) {
    const donut = document.getElementById('elimDonut');
    const totalEl = document.getElementById('elimDonutTotal');
    const legend = document.getElementById('elimDonutLegend');
    if (!donut) return;

    const total = stats.total;
    if (totalEl) totalEl.textContent = String(total);

    if (total === 0) {
      donut.className = 'elim-donut elim-donut--empty';
      donut.style.background = '';
      if (legend) {
        legend.innerHTML =
          '<li><span class="elim-donut-legend__dot elim-donut-legend__dot--muted"></span><span class="elim-donut-legend__label">Нет нарушений</span><span class="elim-donut-legend__val">0</span></li>';
      }
      return;
    }

    donut.classList.remove('elim-donut--empty');
    const done = stats.done;
    const overdue = stats.overdue;
    const onTime = stats.onTime;
    const other = Math.max(0, total - done - overdue - onTime);

    const deg = (n) => (n / total) * 360;
    let cursor = 0;
    const segments = [];
    const push = (size, color) => {
      if (size <= 0) return;
      const start = cursor;
      cursor += deg(size);
      segments.push(`${color} ${start}deg ${cursor}deg`);
    };
    push(done, 'var(--success)');
    push(overdue, 'var(--danger)');
    push(onTime, 'var(--primary)');
    push(other, '#cbd5e1');
    donut.style.background = `conic-gradient(${segments.join(', ')})`;

    if (legend) {
      const rows = [
        { cls: 'done', label: 'Устранено', val: done },
        { cls: 'overdue', label: 'Просрочено', val: overdue },
        { cls: 'ontime', label: 'Срок не истёк', val: onTime },
      ];
      if (other > 0) {
        rows.push({ cls: 'muted', label: 'Прочее', val: other });
      }
      legend.innerHTML = rows
        .map(
          (r) =>
            `<li><span class="elim-donut-legend__dot elim-donut-legend__dot--${r.cls}"></span><span class="elim-donut-legend__label">${AktUtils.escapeHtml(r.label)}</span><span class="elim-donut-legend__val">${r.val}</span></li>`
        )
        .join('');
    }
  }

  function renderYearPills(data) {
    const wrap = document.getElementById('elimYearPills');
    if (!wrap) return;
    const years = getAvailableYears(data);
    const pills = [
      { label: 'Все', year: null },
      ...years.map((y) => ({ label: String(y), year: y })),
    ];
    const yearHtml = pills
      .map(({ label, year }) => {
        const active =
          year === selectedYear || (year == null && selectedYear == null);
        return `<button type="button" class="btn-org-filter${active ? ' btn-org-filter-active' : ''}" data-elim-year="${year == null ? '' : year}">${AktUtils.escapeHtml(label)}</button>`;
      })
      .join('');
    const overdueActive = selectedFilter === 'overdue';
    wrap.innerHTML =
      yearHtml +
      `<button type="button" class="btn-org-filter btn-org-filter--overdue${overdueActive ? ' btn-org-filter-active' : ''}" data-elim-filter="overdue">Просрочено</button>`;
  }

  function bindYearPills() {
    const screen = document.getElementById('screen-elimination');
    if (!screen || screen.dataset.elimYearBound) return;
    screen.dataset.elimYearBound = '1';
    screen.addEventListener('click', async (e) => {
      const filterBtn = e.target.closest('[data-elim-filter]');
      if (filterBtn) {
        handleStatusFilter(filterBtn.dataset.elimFilter || 'all');
        const catalog = await GazpromStore.get();
        render(catalog);
        return;
      }
      const btn = e.target.closest('#elimYearPills [data-elim-year]');
      if (!btn) return;
      const raw = btn.dataset.elimYear;
      selectedYear = raw === '' ? null : parseInt(raw, 10);
      const catalog = await GazpromStore.get();
      render(catalog);
    });
  }

  function renderCardListHtml(items, emptyMessage) {
    if (!items.length) {
      return `<p class="elimination-empty" role="status">${AktUtils.escapeHtml(emptyMessage || 'Нет актов для отображения')}</p>`;
    }
    return items
      .map((item) => {
        const allDone = item.allEliminated;
        const noViolations = item.totalViolations === 0;
        const overdue = item.hasOverdue;
        const cardClass = [
          'elimination-act-card',
          allDone ? 'elimination-act-card--done' : '',
          overdue ? 'elimination-act-card--overdue' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const ring = ringMetrics(item.eliminatedViolations, item.totalViolations);
        const ringCount = noViolations
          ? '0'
          : `${item.eliminatedViolations}/${item.totalViolations}`;
        const headerHtml = buildActHeaderHtml(item.aktNumber, item.akt, item, noViolations);
        const objectHtml = buildObjectHtml(item.akt);
        const statusLineHtml = buildStatusLineHtml(overdue, noViolations);
        const toggleHtml = buildToggleBtnHtml(item, allDone, overdue, noViolations);
        const ringStateClass = allDone
          ? 'elimination-act-card__ring--done'
          : overdue
            ? 'elimination-act-card__ring--overdue'
            : noViolations
              ? 'elimination-act-card__ring--empty'
              : 'elimination-act-card__ring--open';

        return `<article class="${cardClass} card" data-elim-akt="${AktUtils.escapeHtml(item.aktId)}" role="listitem" tabindex="0" aria-label="Акт № ${AktUtils.escapeHtml(item.aktNumber)}, устранено ${item.eliminatedViolations} из ${item.totalViolations}">
          <div class="elimination-act-card__ring ${ringStateClass}" aria-hidden="true">
            <svg class="elim-ring" viewBox="0 0 68 68">
              <circle class="elim-ring__track" cx="${RING_CX}" cy="${RING_CX}" r="${RING_R}"></circle>
              <circle class="elim-ring__fill" cx="${RING_CX}" cy="${RING_CX}" r="${RING_R}" stroke-dasharray="${ring.dash}"></circle>
            </svg>
            <span class="elim-ring__label">${AktUtils.escapeHtml(ringCount)}</span>
          </div>
          <div class="elimination-act-card__content">
            <div class="elimination-act-card__header">
              <div class="elimination-act-card__body">
                ${headerHtml}
              </div>
              <div class="elimination-act-card__aside">
                ${toggleHtml}
                <span class="elimination-act-card__chevron" aria-hidden="true">›</span>
              </div>
            </div>
            <div class="elimination-act-card__foot">
              ${objectHtml}
              ${statusLineHtml}
            </div>
          </div>
        </article>`;
      })
      .join('');
  }

  function filterEmptyMessage() {
    if (selectedFilter === 'overdue') return 'Нет просроченных актов';
    if (selectedFilter === 'done') return 'Нет устранённых актов';
    if (selectedFilter === 'open') return 'Нет актов с истёкшим сроком';
    if (selectedFilter === 'inwork') return 'Нет актов в работе';
    return 'Нет актов для отображения';
  }

  function renderCardList(items) {
    const list = document.getElementById('eliminationCardList');
    if (!list) return;
    list.innerHTML = renderCardListHtml(items, filterEmptyMessage());
  }

  function render(data) {
    let synced = false;
    for (const akt of data.akts || []) {
      if (AktUtils.syncViolationEliminationsForAkt(data, akt)) synced = true;
    }
    if (synced) schedulePersist(data);

    const items = buildEliminationItems(data);
    renderYearPills(data);
    renderStats(items);
    renderDonut(computeStats(items));
    renderCardList(applyStatusFilter(items));
    return items;
  }

  function ensureEliminationsForAkt(catalog, akt) {
    const changed = AktUtils.syncViolationEliminationsForAkt(catalog, akt);
    const violationIds = new Set((akt.violations || []).map((v) => v.id));
    const eliminations = (catalog.violationEliminations || []).filter(
      (e) => aktIdMatch(e.aktId, akt.id) && violationIds.has(e.violationId)
    );
    return { changed, eliminations };
  }

  async function toggleAllForAkt(aktId, shouldEliminate) {
    const catalog = await GazpromStore.get();
    const akt = (catalog.akts || []).find((a) => aktIdMatch(a.id, aktId));
    if (!akt) return;

    ensureEliminationsForAkt(catalog, akt);
    const violationIds = new Set((akt.violations || []).map((v) => v.id));
    const now = new Date().toISOString();

    catalog.violationEliminations = (catalog.violationEliminations || []).map((e) => {
      if (!aktIdMatch(e.aktId, aktId) || !violationIds.has(e.violationId)) return e;
      return {
        ...e,
        isEliminated: shouldEliminate,
        eliminatedAt: shouldEliminate ? e.eliminatedAt || now : e.eliminatedAt,
        eliminationDate: shouldEliminate ? now : e.eliminationDate,
      };
    });

    for (const v of akt.violations || []) {
      const exists = catalog.violationEliminations.find(
        (e) => aktIdMatch(e.aktId, aktId) && e.violationId === v.id
      );
      if (!exists && shouldEliminate) {
        catalog.violationEliminations.push({
          id: AktUtils.uuid(),
          aktId: akt.id,
          aktNumber: akt.number,
          violationId: v.id,
          violationTitle: v.title,
          isEliminated: true,
          eliminatedAt: now,
          eliminationDate: now,
          originalEliminationDate: AktUtils.getEliminationDeadline(akt),
          deadlineHistory: [],
        });
      }
    }

    schedulePersist(catalog);
    refreshEliminationLight(catalog, aktId);

    if (detailState && aktIdMatch(detailState.akt.id, aktId)) {
      detailState.eliminations = (catalog.violationEliminations || []).filter((e) =>
        aktIdMatch(e.aktId, aktId)
      );
      detailState.pickedDone.clear();
      detailState.pickedExtend.clear();
      renderDetailViolations();
      updateDetailFooter();
    }
  }

  function closeDetail() {
    document.documentElement.classList.remove('elim-work-open');
    document.removeEventListener('keydown', onDetailKey);
    void flushPersist();
    if (document.querySelector('.elimination-detail-overlay')) {
      GazpromMobileOverlay.unlock();
    }
    document.querySelector('.elimination-detail-overlay')?.remove();
    detailState = null;
    void GazpromStore.get().then((catalog) => {
      refreshEliminationLight(catalog);
    });
  }

  function detailElimination(violationId) {
    return detailState?.eliminations.find((e) => e.violationId === violationId);
  }

  function detailOpenIds() {
    if (!detailState) return [];
    return detailState.violations
      .filter((v) => !detailElimination(v.id)?.isEliminated)
      .map((v) => v.id);
  }

  function detailPickSet() {
    return detailState?.mode === 'extend' ? detailState.pickedExtend : detailState.pickedDone;
  }

  function detailPickedOpenIds() {
    const open = new Set(detailOpenIds());
    return [...detailPickSet()].filter((id) => open.has(id));
  }

  function onDetailKey(e) {
    if (e.key !== 'Escape') return;
    if (!document.querySelector('.elimination-detail-overlay')) return;
    if (detailState?.screen && detailState.screen !== 'list') {
      showWorkScreen('list');
      return;
    }
    closeDetail();
  }

  function detailRowMeta(el, akt, done, overdue) {
    if (done) {
      const when = el?.eliminationDate || el?.eliminatedAt;
      return {
        text: when ? `Устранено · ${AktUtils.formatDateShort(when)}` : 'Устранено',
        cls: 'elim-work__meta elim-work__meta--ok',
      };
    }
    const deadline = el ? eliminationDeadline(el, akt) : null;
    if (!deadline) return { text: 'Срок не установлен', cls: 'elim-work__meta' };
    if (overdue) {
      return {
        text: `Просрочено · ${AktUtils.formatDateShort(deadline)}`,
        cls: 'elim-work__meta elim-work__meta--bad',
      };
    }
    return { text: `Срок: ${AktUtils.formatDateShort(deadline)}`, cls: 'elim-work__meta' };
  }

  function deadlineHistoryLines(el, akt) {
    const lines = [];
    const extensions = AktUtils.extensionDeadlineHistory(el?.deadlineHistory);
    const original = el?.originalEliminationDate;
    const current = el ? eliminationDeadline(el, akt) : AktUtils.getEliminationDeadline(akt);
    const listed = (iso) => lines.some((line) => AktUtils.sameDeadlineDay(line.iso, iso));
    if (original) {
      lines.push({ iso: original, date: AktUtils.formatDateShort(original), note: 'Исходный срок' });
    }
    extensions.forEach((h) => {
      if (!h?.deadlineDate || listed(h.deadlineDate)) return;
      lines.push({
        iso: h.deadlineDate,
        date: AktUtils.formatDateShort(h.deadlineDate),
        note: h.reason || 'Продление',
      });
    });
    if (current && !listed(current)) {
      lines.push({ iso: current, date: AktUtils.formatDateShort(current), note: 'Текущий срок' });
    }
    return lines;
  }

  function renderDetailViolations() {
    if (!detailState) return;
    const { violations, akt, mode } = detailState;
    const body = document.getElementById('elimDetailBody');
    if (!body) return;
    const pickSet = detailPickSet();
    const toShow = mode === 'extend'
      ? violations.filter((v) => !detailElimination(v.id)?.isEliminated)
      : violations;

    if (!toShow.length) {
      body.innerHTML = '<p class="elim-work__hint" role="status">Открытых нарушений нет.</p>';
      return;
    }

    body.innerHTML = toShow
      .map((v) => {
        const el = detailElimination(v.id);
        const done = Boolean(el?.isEliminated);
        const overdue = el && isEliminationOverdue(el, akt);
        const pressed = done || pickSet.has(v.id);
        const switchClass = done ? 'elim-work__switch is-done' : 'elim-work__switch';
        const switchLabel = done
          ? `Снять отметку: ${v.title || ''}`
          : `Ползунок: ${v.title || ''}`;
        const meta = detailRowMeta(el, akt, done, overdue);

        return `<div class="elim-work__line">
          <button type="button" class="elim-work__main" data-elim-history="${AktUtils.escapeHtml(v.id)}">
            <span class="elim-work__title">${AktUtils.escapeHtml(v.title)}</span>
            <span class="${meta.cls}">${AktUtils.escapeHtml(meta.text)}</span>
          </button>
          <button type="button" class="${switchClass}" data-elim-switch="${AktUtils.escapeHtml(v.id)}" aria-pressed="${pressed ? 'true' : 'false'}" aria-label="${AktUtils.escapeHtml(switchLabel)}">
            <span class="elim-work__knob" aria-hidden="true"></span>
          </button>
        </div>`;
      })
      .join('');
  }

  function showWorkScreen(name) {
    if (!detailState) return;
    detailState.screen = name;
    document.querySelectorAll('[data-elim-screen]').forEach((section) => {
      section.hidden = section.dataset.elimScreen !== name;
    });
  }

  function setListError(message) {
    const el = document.getElementById('elimWorkError');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
  }

  function updateDetailFooter() {
    if (!detailState) return;
    const extend = detailState.mode === 'extend';
    const open = detailOpenIds();
    const picked = detailPickedOpenIds();
    const countEl = document.getElementById('elimPickedCount');
    if (countEl) countEl.textContent = String(picked.length);
    const hint = document.getElementById('elimModeHint');
    if (hint) {
      hint.textContent = extend
        ? '«Отметить все» только сдвигает ползунки. Новый срок — по кнопке «Продлить».'
        : '«Отметить все» только сдвигает ползунки. Дата — по кнопке «Устранено».';
    }
    const apply = document.getElementById('elimDetailApply');
    if (apply) {
      apply.textContent = extend ? 'Продлить' : 'Устранено';
      apply.className = extend
        ? 'elim-work__btn elim-work__btn--fill'
        : 'elim-work__btn elim-work__btn--ok';
    }
    const allBtn = document.getElementById('elimDetailToggleAll');
    if (allBtn) {
      const allOn = open.length > 0 && open.every((id) => detailPickSet().has(id));
      allBtn.textContent = allOn ? 'Снять все' : 'Отметить все';
      allBtn.hidden = open.length === 0;
    }
  }

  function setDetailMode(mode) {
    if (!detailState) return;
    detailState.mode = mode;
    const doneBtn = document.getElementById('elimModeDone');
    const extBtn = document.getElementById('elimModeExtend');
    doneBtn?.classList.toggle('is-on', mode === 'done');
    extBtn?.classList.toggle('is-on', mode === 'extend');
    doneBtn?.setAttribute('aria-pressed', mode === 'done' ? 'true' : 'false');
    extBtn?.setAttribute('aria-pressed', mode === 'extend' ? 'true' : 'false');
    setListError('');
    renderDetailViolations();
    updateDetailFooter();
  }

  function toggleAllDetailPicks() {
    if (!detailState) return;
    const ids = detailOpenIds();
    const set = detailPickSet();
    const allOn = ids.length > 0 && ids.every((id) => set.has(id));
    ids.forEach((id) => {
      if (allOn) set.delete(id);
      else set.add(id);
    });
    setListError('');
    renderDetailViolations();
    updateDetailFooter();
  }

  async function openDetail(item) {
    const catalog = await GazpromStore.get();
    const akt = (catalog.akts || []).find((a) => aktIdMatch(a.id, item.aktId));
    if (!akt) {
      GazpromToast.error('Акт не найден');
      return;
    }

    await CatalogService.rememberLastOpenedAkt(akt);

    const { changed, eliminations } = ensureEliminationsForAkt(catalog, akt);
    if (changed) await GazpromStore.set(catalog);

    detailState = {
      item,
      akt,
      catalog,
      violations: [...(akt.violations || [])],
      eliminations,
      mode: 'done',
      screen: 'list',
      histViolationId: null,
      pickedDone: new Set(),
      pickedExtend: new Set(),
    };

    const org = AktSearch.getOrgTitle(akt);
    const objectTitle = (akt.objectsCheck || [])[0]?.title || '—';

    const overlay = document.createElement('div');
    overlay.className = 'elimination-detail-overlay';
    overlay.innerHTML = `
      <div class="elimination-detail-sheet elim-work" role="dialog" aria-modal="true" aria-labelledby="elimDetailTitle">
        <section class="elim-work__screen" data-elim-screen="list">
          <header class="elim-work__head">
            <div class="elim-work__bar">
              <button type="button" class="elim-work__link" id="elimDetailClose">Закрыть</button>
              <button type="button" class="elim-work__link" id="elimDetailHistory">История</button>
            </div>
            <div class="elim-work__top">
              <div>
                <p class="elim-work__kicker">Акт № ${AktUtils.escapeHtml(item.aktNumber)}</p>
                <h3 id="elimDetailTitle">${AktUtils.escapeHtml(org)}</h3>
                <p class="elim-work__sub">${AktUtils.escapeHtml(objectTitle)}</p>
              </div>
            </div>
            <div class="elim-work__seg" role="group" aria-label="Режим">
              <button type="button" id="elimModeDone" class="is-on" aria-pressed="true">Устранено</button>
              <button type="button" id="elimModeExtend" aria-pressed="false">Продлить</button>
            </div>
          </header>
          <div class="elim-work__body">
            <p class="elim-work__hint" id="elimModeHint"></p>
            <div class="elim-work__lines" id="elimDetailBody"></div>
            <p class="elim-work__error" id="elimWorkError" hidden>Включите ползунок хотя бы у одного нарушения.</p>
          </div>
          <footer class="elim-work__foot">
            <p class="elim-work__count" aria-live="polite">Включено: <span id="elimPickedCount">0</span></p>
            <button type="button" class="elim-work__btn elim-work__btn--ok" id="elimDetailApply">Устранено</button>
            <button type="button" class="elim-work__btn elim-work__btn--ghost" id="elimDetailToggleAll">Отметить все</button>
          </footer>
        </section>
        <section class="elim-work__screen" data-elim-screen="fact" hidden>
          <header class="elim-work__head">
            <div class="elim-work__bar">
              <button type="button" class="elim-work__link" data-elim-back>Назад</button>
              <button type="button" class="elim-work__link" data-elim-close>Закрыть</button>
            </div>
            <h3>Дата факта</h3>
            <p class="elim-work__sub" id="elimFactSub">Для включённых ползунков</p>
          </header>
          <div class="elim-work__body">
            <label class="elim-work__label" for="elimFactDate">Когда устранили</label>
            <input class="elim-work__input" id="elimFactDate" type="date">
            <p class="elim-work__error" id="elimFactErr" hidden>Укажите дату факта.</p>
          </div>
          <footer class="elim-work__foot">
            <button type="button" class="elim-work__btn elim-work__btn--ok" id="elimFactSave">Сохранить</button>
          </footer>
        </section>
        <section class="elim-work__screen" data-elim-screen="date" hidden>
          <header class="elim-work__head">
            <div class="elim-work__bar">
              <button type="button" class="elim-work__link" data-elim-back>Назад</button>
              <button type="button" class="elim-work__link" data-elim-close>Закрыть</button>
            </div>
            <h3>Новый срок</h3>
            <p class="elim-work__sub" id="elimDateSub">Для включённых ползунков</p>
          </header>
          <div class="elim-work__body">
            <label class="elim-work__label" for="elimExtendDate">Дата</label>
            <input class="elim-work__input" id="elimExtendDate" type="date">
            <label class="elim-work__label" for="elimExtendReason">Причина</label>
            <input class="elim-work__input" id="elimExtendReason" type="text" placeholder="Ожидание материалов">
            <p class="elim-work__error" id="elimDateErr" hidden>Укажите новый срок.</p>
          </div>
          <footer class="elim-work__foot">
            <button type="button" class="elim-work__btn elim-work__btn--fill" id="elimDateSave">Продлить</button>
          </footer>
        </section>
        <section class="elim-work__screen" data-elim-screen="hist" hidden>
          <header class="elim-work__head">
            <div class="elim-work__bar">
              <button type="button" class="elim-work__link" data-elim-back>Назад</button>
              <button type="button" class="elim-work__link" data-elim-close>Закрыть</button>
            </div>
            <h3 id="elimHistTitle">История сроков</h3>
            <p class="elim-work__sub" id="elimHistSub">Все нарушения акта</p>
          </header>
          <div class="elim-work__body" id="elimHistBody"></div>
          <footer class="elim-work__foot" id="elimUnmarkFoot" hidden>
            <button type="button" class="elim-work__btn elim-work__btn--ghost" id="elimUnmark">Снять отметку</button>
          </footer>
        </section>
      </div>
    `;
    document.body.appendChild(overlay);
    GazpromMobileOverlay.lock();
    document.documentElement.classList.add('elim-work-open');
    document.addEventListener('keydown', onDetailKey);

    let panX = 0;
    let panY = 0;
    overlay.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      panX = e.touches[0].clientX;
      panY = e.touches[0].clientY;
    }, { passive: true });
    overlay.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      if (e.target.closest('input, textarea, select')) return;
      const body = e.target.closest('.elim-work__body');
      const dx = e.touches[0].clientX - panX;
      const dy = e.touches[0].clientY - panY;
      const vertical = Math.abs(dy) > Math.abs(dx);
      const canScroll = body && body.scrollHeight > body.clientHeight + 1;
      if (!body || !vertical || !canScroll) e.preventDefault();
    }, { passive: false });
    overlay.addEventListener('wheel', (e) => {
      const body = e.target.closest('.elim-work__body');
      if (!body || Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
    }, { passive: false });

    overlay.querySelectorAll('#elimDetailClose, [data-elim-close]').forEach((btn) => {
      btn.addEventListener('click', closeDetail);
    });
    overlay.querySelectorAll('[data-elim-back]').forEach((btn) => {
      btn.addEventListener('click', () => showWorkScreen('list'));
    });
    overlay.querySelector('#elimModeDone')?.addEventListener('click', () => setDetailMode('done'));
    overlay.querySelector('#elimModeExtend')?.addEventListener('click', () => setDetailMode('extend'));
    overlay.querySelector('#elimDetailHistory')?.addEventListener('click', () => showDeadlineHistory());
    overlay.querySelector('#elimDetailToggleAll')?.addEventListener('click', toggleAllDetailPicks);
    overlay.querySelector('#elimDetailApply')?.addEventListener('click', () => {
      if (!detailPickedOpenIds().length) {
        setListError('Включите ползунок хотя бы у одного нарушения.');
        return;
      }
      setListError('');
      if (detailState?.mode === 'extend') showExtendDateDialog();
      else showFactDateDialog();
    });
    overlay.querySelector('#elimFactSave')?.addEventListener('click', async () => {
      const dateVal = document.getElementById('elimFactDate')?.value;
      const err = document.getElementById('elimFactErr');
      if (!dateVal) {
        if (err) {
          err.hidden = false;
          err.textContent = 'Укажите дату факта.';
        }
        return;
      }
      if (err) err.hidden = true;
      await markPickedEliminated(new Date(dateVal + 'T12:00:00').toISOString());
    });
    overlay.querySelector('#elimDateSave')?.addEventListener('click', async () => {
      const dateVal = document.getElementById('elimExtendDate')?.value;
      const err = document.getElementById('elimDateErr');
      if (!dateVal) {
        if (err) {
          err.hidden = false;
          err.textContent = 'Укажите новый срок.';
        }
        return;
      }
      if (err) err.hidden = true;
      const reason = document.getElementById('elimExtendReason')?.value?.trim() || null;
      await extendDeadlinesForSelected(new Date(dateVal + 'T12:00:00').toISOString(), reason);
    });
    overlay.querySelector('#elimUnmark')?.addEventListener('click', async () => {
      const id = detailState?.histViolationId;
      if (!id) return;
      await clearElimination(id);
      showWorkScreen('list');
    });

    updateDetailFooter();
    renderDetailViolations();

    overlay.querySelector('#elimDetailBody')?.addEventListener('click', async (e) => {
      if (!detailState) return;
      const historyBtn = e.target.closest('[data-elim-history]');
      if (historyBtn) {
        showDeadlineHistory(historyBtn.dataset.elimHistory);
        return;
      }
      const switchBtn = e.target.closest('[data-elim-switch]');
      if (!switchBtn) return;
      const vid = switchBtn.dataset.elimSwitch;
      const done = Boolean(detailElimination(vid)?.isEliminated);
      if (detailState.mode === 'done' && done) {
        await clearElimination(vid);
        return;
      }
      const set = detailPickSet();
      if (set.has(vid)) set.delete(vid);
      else set.add(vid);
      setListError('');
      renderDetailViolations();
      updateDetailFooter();
    });
  }

  function showExtendDateDialog() {
    const sub = document.getElementById('elimDateSub');
    if (sub) sub.textContent = `Для включённых: ${detailPickedOpenIds().length}`;
    const err = document.getElementById('elimDateErr');
    if (err) err.hidden = true;
    const input = document.getElementById('elimExtendDate');
    if (input) {
      const next = new Date();
      next.setDate(next.getDate() + 30);
      input.value = AktUtils.toDateInputValue(next.toISOString());
    }
    const reason = document.getElementById('elimExtendReason');
    if (reason) reason.value = '';
    showWorkScreen('date');
  }

  function showFactDateDialog() {
    const sub = document.getElementById('elimFactSub');
    if (sub) sub.textContent = `Для включённых: ${detailPickedOpenIds().length}`;
    const err = document.getElementById('elimFactErr');
    if (err) err.hidden = true;
    const input = document.getElementById('elimFactDate');
    if (input) input.value = AktUtils.toDateInputValue(new Date().toISOString());
    showWorkScreen('fact');
  }

  async function extendDeadlinesForSelected(newIso, reason) {
    if (!detailState) return;
    const catalog = await GazpromStore.get();
    const { akt, pickedExtend } = detailState;
    const now = new Date().toISOString();

    let extendedCount = 0;
    const extendedIds = new Set();
    catalog.violationEliminations = (catalog.violationEliminations || []).map((e) => {
      if (!aktIdMatch(e.aktId, akt.id) || !pickedExtend.has(e.violationId)) return e;
      const prevDeadline = eliminationDeadline(e, akt);
      if (AktUtils.sameDeadlineDay(prevDeadline, newIso)) return e;
      extendedCount += 1;
      extendedIds.add(e.violationId);
      const history = AktUtils.extensionDeadlineHistory(e.deadlineHistory);
      return {
        ...e,
        newEliminationDate: newIso,
        originalEliminationDate: e.originalEliminationDate || prevDeadline,
        deadlineHistory: [
          ...history,
          {
            id: AktUtils.uuid(),
            deadlineDate: newIso,
            changeDate: now,
            reason,
            isOriginal: false,
          },
        ],
      };
    });

    if (extendedCount === 0) {
      const err = document.getElementById('elimDateErr');
      if (err) {
        err.hidden = false;
        err.textContent = 'Новый срок совпадает с текущим.';
      }
      return false;
    }

    extendedIds.forEach((id) => detailState.pickedExtend.delete(id));
    schedulePersist(catalog);
    detailState.eliminations = (catalog.violationEliminations || []).filter((e) =>
      aktIdMatch(e.aktId, akt.id)
    );
    renderDetailViolations();
    updateDetailFooter();
    refreshEliminationLight(catalog, akt.id);
    showWorkScreen('list');
    GazpromToast.success('Сроки продлены');
    return true;
  }

  function showDeadlineHistory(violationId) {
    if (!detailState) return;
    detailState.histViolationId = violationId || null;
    const { violations, akt, eliminations } = detailState;
    const one = violationId ? violations.find((v) => v.id === violationId) : null;
    const title = document.getElementById('elimHistTitle');
    const sub = document.getElementById('elimHistSub');
    if (title) title.textContent = one?.title || 'История сроков';
    if (sub) sub.textContent = one ? 'Сроки этого нарушения' : 'Все нарушения акта';

    const list = one ? [one] : violations;
    const body = document.getElementById('elimHistBody');
    if (body) {
      body.innerHTML = list
        .map((v) => {
          const el = eliminations.find((e) => e.violationId === v.id);
          const lines = deadlineHistoryLines(el, akt);
          const items = lines.length
            ? lines
                .map(
                  (line) =>
                    `<li><span>${AktUtils.escapeHtml(line.date)}</span><span>${AktUtils.escapeHtml(line.note)}</span></li>`
                )
                .join('')
            : '<li><span>—</span><span>Сроков нет</span></li>';
          return `<article class="elim-work__block"><h3>${AktUtils.escapeHtml(v.title || 'Нарушение')}</h3><ol class="elim-work__ol">${items}</ol></article>`;
        })
        .join('');
    }

    const foot = document.getElementById('elimUnmarkFoot');
    const eliminated = Boolean(one && eliminations.find((e) => e.violationId === one.id)?.isEliminated);
    if (foot) foot.hidden = !eliminated;
    showWorkScreen('hist');
  }

  async function clearElimination(violationId) {
    if (!detailState) return;
    const catalog = await GazpromStore.get();
    const { akt } = detailState;
    const rec = (catalog.violationEliminations || []).find(
      (e) => aktIdMatch(e.aktId, akt.id) && e.violationId === violationId && e.isEliminated
    );
    if (!rec) return;
    catalog.violationEliminations = (catalog.violationEliminations || []).map((e) =>
      e.id === rec.id ? { ...e, isEliminated: false } : e
    );
    detailState.pickedDone.delete(violationId);
    detailState.pickedExtend.delete(violationId);
    schedulePersist(catalog);
    detailState.eliminations = (catalog.violationEliminations || []).filter((e) =>
      aktIdMatch(e.aktId, akt.id)
    );
    renderDetailViolations();
    updateDetailFooter();
    refreshEliminationLight(catalog, akt.id);
  }

  async function markPickedEliminated(newIso) {
    if (!detailState) return false;
    const catalog = await GazpromStore.get();
    const { akt } = detailState;
    const ids = new Set(detailPickedOpenIds());
    if (!ids.size) return false;

    catalog.violationEliminations = (catalog.violationEliminations || []).map((e) => {
      if (!aktIdMatch(e.aktId, akt.id) || !ids.has(e.violationId)) return e;
      return { ...e, isEliminated: true, eliminatedAt: newIso, eliminationDate: newIso };
    });
    for (const v of akt.violations || []) {
      if (!ids.has(v.id)) continue;
      const exists = (catalog.violationEliminations || []).some(
        (e) => aktIdMatch(e.aktId, akt.id) && e.violationId === v.id
      );
      if (exists) continue;
      catalog.violationEliminations.push({
        id: AktUtils.uuid(),
        aktId: akt.id,
        aktNumber: akt.number,
        violationId: v.id,
        violationTitle: v.title,
        isEliminated: true,
        eliminatedAt: newIso,
        eliminationDate: newIso,
        originalEliminationDate: AktUtils.getEliminationDeadline(akt),
        deadlineHistory: [],
      });
    }
    ids.forEach((id) => detailState.pickedDone.delete(id));
    schedulePersist(catalog);
    detailState.eliminations = (catalog.violationEliminations || []).filter((e) =>
      aktIdMatch(e.aktId, akt.id)
    );
    renderDetailViolations();
    updateDetailFooter();
    refreshEliminationLight(catalog, akt.id);
    showWorkScreen('list');
    GazpromToast.success('Отмечено как устранённое');
    return true;
  }


  function bindCardList() {
    const list = document.getElementById('eliminationCardList');
    if (!list || list.dataset.bound) return;
    list.dataset.bound = '1';

    list.addEventListener('click', async (e) => {
      const toggleBtn = e.target.closest('[data-elim-toggle]');
      if (toggleBtn) {
        e.stopPropagation();
        const aktId = toggleBtn.dataset.elimToggle;
        const data = await GazpromStore.get();
        const items = buildEliminationItems(data);
        const item = items.find((i) => aktIdMatch(i.aktId, aktId));
        if (!item || item.totalViolations === 0) return;
        await toggleAllForAkt(aktId, !item.allEliminated);
        return;
      }

      const card = e.target.closest('[data-elim-akt]');
      if (!card) return;
      const aktId = card.dataset.elimAkt;
      const data = await GazpromStore.get();
      const items = buildEliminationItems(data);
      const item = items.find((i) => aktIdMatch(i.aktId, aktId));
      if (item) openDetail(item);
    });

    list.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('[data-elim-toggle]')) return;
      const card = e.target.closest('[data-elim-akt]');
      if (!card) return;
      e.preventDefault();
      const data = await GazpromStore.get();
      const items = buildEliminationItems(data);
      const item = items.find((i) => aktIdMatch(i.aktId, card.dataset.elimAkt));
      if (item) openDetail(item);
    });
  }

  function bindFilters() {
    /* фильтр «Просрочено» — в блоке elimYearPills (bindYearPills) */
  }

  function bindBulkActions() {
    /* массовая отметка — через свайп-кнопку на карточке акта */
  }

  function bindTableActions() {
    bindCardList();
    bindYearPills();
  }

  return {
    render,
    buildEliminationItems,
    bindFilters,
    bindBulkActions,
    bindTableActions,
    flushPersist,
    getYearFilter: () => selectedYear,
  };
})();
