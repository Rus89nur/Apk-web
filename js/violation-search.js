/**
 * ViolationSearch — умный поиск по реестру и нарушениям акта.
 *
 * filterRegistry / filterActViolations — строгий поиск:
 * - нормализация (регистр, ё→е, пунктуация, тире, пробелы);
 * - кавычки "..." / «...» — точная фраза;
 * - несколько слов — логика И (каждый токен должен встретиться);
 * - короткие токены (1–2 символа) — только точное вхождение, без префиксов;
 * - ранжирование: формулировка > номер > вид > прочие поля.
 *
 * suggestRegistry / placesMatch / mapPhotoHints — мягкий подбор модалки нарушения.
 */
const ViolationSearch = (() => {
  const MIN_PREFIX_LEN = 3;
  const MAX_RESULTS = 200;
  const LEADER_SCORE_RATIO = 1.35;
  const PLACE_BONUS = 30;
  const DESCRIPTION_ALL_TOKENS_BONUS = 32;
  const PHOTO_HINT_MIN_ITEM = 0.25;
  const PHOTO_HINT_MIN_TOP = 0.35;

  const STOP_WORDS = new Set([
    'в', 'во', 'на', 'по', 'с', 'со', 'к', 'ко', 'о', 'об', 'у', 'от', 'из',
    'для', 'при', 'до', 'за', 'а', 'и', 'или', 'это', 'как', 'же', 'бы', 'ли', 'то', 'что',
  ]);
  /** Не участвует в подсчёте «полного» совпадения — иначе «не» встречается почти в каждой формулировке. */
  const SUGGEST_WEAK_TOKENS = new Set(['не']);

  const ABSENCE_QUERY = new Set(['нет', 'отсутствует', 'отсутствуют', 'нету']);
  const ABSENCE_FIELD = new Set(['нет', 'отсутствует', 'отсутствуют', 'нету', 'не', 'без']);

  const STEM_ENDINGS = [
    'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
    'ах', 'ях', 'ов', 'ев', 'ом', 'ем', 'ам', 'ям',
    'ой', 'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их', 'ую', 'юю',
    'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь',
  ];

  const SYNONYM_GROUPS = [
    ['каска', 'шлем'],
    ['работник', 'рабочий', 'персонал'],
    ['огнетушитель'],
    ['перезаряд', 'перезарядк', 'перезарядка', 'перезаряж', 'перезаряжен', 'зарядк', 'зарядка'],
    ['щитовая', 'электрощитовая'],
    ['захламление', 'загромождение'],
    ['светильник', 'лампа', 'электролампа'],
    ['эвакуация', 'эвакуационный'],
    ['ппр', 'противопожарный', 'противопожарного'],
    ['проход', 'проезд'],
    ['лестница', 'стремянка'],
    ['знак', 'табличка'],
    ['перчатки', 'рукавицы'],
    ['баллон', 'газобаллон'],
    ['провод', 'кабель', 'проводка', 'электропроводка'],
    ['розетка', 'электророзетка'],
    ['аптечка', 'медикаменты'],
    ['ограждение', 'перила'],
    ['котлован', 'траншея'],
    ['мусор', 'отходы'],
    ['курение', 'курит'],
    ['инструктаж', 'инструкция'],
    ['сиз', 'спецодежда'],
  ];

  function normalize(str) {
    return String(str ?? '')
      .toLowerCase()
      .replace(/\u0451/g, '\u0435')
      .replace(/[\u00a0\u202f\u2007\u2009\u200a\u200b\ufeff]/g, ' ')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[^0-9a-z\u0430-\u044f\-]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function expandText(normalized) {
    if (!normalized) return '';
    const dehyphen = normalized.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    return dehyphen === normalized ? normalized : `${normalized} ${dehyphen}`;
  }

  function parseQuery(raw) {
    const query = String(raw ?? '').trim();
    if (!query) {
      return { raw: '', phrases: [], tokens: [], isEmpty: true };
    }

    const phrases = [];
    let rest = query;

    const pullQuoted = (pattern) => {
      rest = rest.replace(pattern, (_, inner) => {
        const p = normalize(inner);
        if (p) phrases.push(p);
        return ' ';
      });
    };

    pullQuoted(/"([^"]+)"/g);
    pullQuoted(/«([^»]+)»/g);
    pullQuoted(/'([^']+)'/g);

    const tokens = expandText(normalize(rest))
      .split(' ')
      .filter((t) => t.length > 0);

    return { raw: query, phrases, tokens, isEmpty: !phrases.length && !tokens.length };
  }

  function registryFields(item) {
    return {
      number: item?.number != null ? String(item.number) : '',
      title: item?.title || '',
      subTitle: item?.subTitle || '',
      description: item?.description || '',
      vid: item?.vid || '',
      formulaFromRules: item?.formulaFromRules || '',
    };
  }

  function actViolationFields(v) {
    return {
      number: '',
      title: v?.title || '',
      subTitle: v?.subTitle || '',
      description: v?.description || '',
      vid: v?.vid || '',
      formulaFromRules: v?.formulaFromRules || '',
      urlToPravilo: v?.urlToPravilo || '',
      mesto: v?.mesto || '',
    };
  }

  function fieldWeightsRegistry() {
    return {
      title: 40,
      number: 35,
      subTitle: 22,
      vid: 18,
      description: 15,
      formulaFromRules: 12,
    };
  }

  function fieldWeightsAct() {
    return {
      title: 40,
      subTitle: 22,
      urlToPravilo: 22,
      mesto: 20,
      vid: 18,
      description: 15,
      formulaFromRules: 12,
      number: 0,
    };
  }

  function buildFieldMaps(fields, weights) {
    const maps = {};
    for (const [key, weight] of Object.entries(weights)) {
      const raw = fields[key] || '';
      const norm = normalize(raw);
      maps[key] = {
        raw,
        norm,
        expanded: expandText(norm),
        weight,
      };
    }
    const combined = Object.values(maps)
      .map((f) => f.expanded)
      .filter(Boolean)
      .join(' ');
    return { maps, combined: expandText(combined) };
  }

  function tokenMatchesField(token, field) {
    if (!token || !field.expanded) return false;
    if (field.expanded.includes(token)) return true;
    if (token.length < MIN_PREFIX_LEN) return false;
    const words = field.expanded.split(' ').filter((w) => w.length >= MIN_PREFIX_LEN);
    return words.some((word) => word.startsWith(token) || token.startsWith(word));
  }

  function phraseMatchesField(phrase, field) {
    if (!phrase || !field.expanded) return false;
    return field.expanded.includes(phrase);
  }

  function scoreNeedle(needle, fieldMaps, combined, isPhrase) {
    let best = 0;
    for (const field of Object.values(fieldMaps)) {
      const hit = isPhrase
        ? phraseMatchesField(needle, field)
        : tokenMatchesField(needle, field);
      if (!hit) continue;
      const exactWord = field.expanded
        .split(' ')
        .some((w) => w === needle);
      best = Math.max(best, field.weight + (exactWord ? 8 : 0));
    }
    if (!best && combined.includes(needle)) best = 4;
    return best;
  }

  function scoreItem(fields, weights, parsed) {
    const { maps, combined } = buildFieldMaps(fields, weights);
    let score = 0;

    for (const phrase of parsed.phrases) {
      const part = scoreNeedle(phrase, maps, combined, true);
      if (!part) return -1;
      score += part * 2;
    }

    for (const token of parsed.tokens) {
      const part = scoreNeedle(token, maps, combined, false);
      if (!part) return -1;
      score += part;
    }

    if (parsed.tokens.length > 1) {
      const title = maps.title?.expanded || '';
      if (parsed.tokens.every((t) => title.includes(t))) score += 25;
    }

    return score;
  }

  function filterAndRank(items, query, mapFields, weights, { vidFilter, catalog } = {}) {
    let list = [...(items || [])];
    if (vidFilter) {
      list = list.filter((x) => {
        if (x.vid === vidFilter) return true;
        if (catalog && typeof ViolationTypes !== 'undefined') {
          return ViolationTypes.resolveVid(catalog, x.vid) === vidFilter;
        }
        return false;
      });
    }

    const parsed = parseQuery(query);
    if (parsed.isEmpty) return list;

    const scored = [];
    for (const item of list) {
      const fields = mapFields(item);
      const score = scoreItem(fields, weights, parsed);
      if (score >= 0) scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score || (a.item.number || 0) - (b.item.number || 0));
    return scored.slice(0, MAX_RESULTS).map((x) => x.item);
  }

  function filterRegistry(items, query, { vidFilter, catalog } = {}) {
    return filterAndRank(items, query, registryFields, fieldWeightsRegistry(), { vidFilter, catalog });
  }

  function filterActViolations(violations, query) {
    return filterAndRank(violations, query, actViolationFields, fieldWeightsAct());
  }

  function placeKey(value) {
    const normalized = normalize(value);
    if (!normalized) return '';
    const dehyphen = normalized.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    if (!dehyphen) return '';
    return dehyphen
      .split(' ')
      .filter(Boolean)
      .map((token) => {
        if (!/^\d+$/.test(token)) return token;
        const stripped = token.replace(/^0+/, '');
        return stripped || '0';
      })
      .join(' ');
  }

  function placesMatch(a, b) {
    const left = placeKey(a);
    const right = placeKey(b);
    if (!left || !right) return false;
    return left === right;
  }

  function isDigits(token) {
    return /^\d+$/.test(token);
  }

  function wordsOf(expanded) {
    return expanded ? expanded.split(' ').filter(Boolean) : [];
  }

  const stemCache = new Map();

  function stemRu(word) {
    if (!word || word.length < 5 || isDigits(word)) return word;
    for (const ending of STEM_ENDINGS) {
      if (!word.endsWith(ending)) continue;
      if (word.length - ending.length < 4) continue;
      if (word.length === ending.length) continue;
      return word.slice(0, word.length - ending.length);
    }
    return word;
  }

  function stemRuCached(word) {
    if (!word) return word;
    let cached = stemCache.get(word);
    if (cached === undefined) {
      cached = stemRu(word);
      stemCache.set(word, cached);
    }
    return cached;
  }

  const SUGGEST_TYPO_FIELD_KEYS = new Set(['title', 'description']);
  const SUGGEST_SHARED_ROOT_FIELD_KEYS = new Set(['title', 'description']);

  function stemsMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 5 && b.length >= 5 && (a.endsWith(b) || b.endsWith(a))) return true;
    return false;
  }

  function exactOrPrefix(token, field) {
    if (!token || !field.expanded) return false;
    if (field.expanded.includes(token)) return true;
    if (token.length < MIN_PREFIX_LEN) return false;
    return wordsOf(field.expanded).some(
      (word) => word.length >= MIN_PREFIX_LEN && (word.startsWith(token) || token.startsWith(word))
    );
  }

  function isExactWord(token, field) {
    return wordsOf(field.expanded).some((word) => word === token);
  }

  function sharedRootHit(token, field) {
    if (!token || !field.expanded || isDigits(token) || token.length < 9) return false;
    const tokenStem = stemRuCached(token);
    const minRoot = tokenStem.length >= 10 ? 7 : 6;
    const maxRoot = Math.min(tokenStem.length, 11);
    for (let len = maxRoot; len >= minRoot; len -= 1) {
      const root = tokenStem.slice(0, len);
      if (root.length < minRoot) break;
      if (
        wordsOf(field.expanded).some((word) => {
          if (isDigits(word) || word.length < minRoot) return false;
          const wordStem = stemRuCached(word);
          return wordStem.startsWith(root) || word.startsWith(root);
        })
      ) {
        return true;
      }
    }
    return false;
  }

  function stemHit(token, field, fieldKey) {
    if (!token || !field.expanded || isDigits(token)) return false;
    const tokenStem = stemRuCached(token);
    const wordStemHit = wordsOf(field.expanded).some((word) => {
      if (isDigits(word)) return false;
      return stemsMatch(tokenStem, stemRuCached(word));
    });
    if (wordStemHit) return true;
    if (fieldKey && !SUGGEST_SHARED_ROOT_FIELD_KEYS.has(fieldKey)) return false;
    return sharedRootHit(token, field);
  }

  function levenshteinWithin(a, b, maxDist) {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    let prev = new Array(lb + 1);
    for (let j = 0; j <= lb; j += 1) prev[j] = j;
    for (let i = 1; i <= la; i += 1) {
      const cur = new Array(lb + 1);
      cur[0] = i;
      let rowMin = cur[0];
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j += 1) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        const del = prev[j] + 1;
        const ins = cur[j - 1] + 1;
        const sub = prev[j - 1] + cost;
        const val = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
        cur[j] = val;
        if (val < rowMin) rowMin = val;
      }
      if (rowMin > maxDist) return maxDist + 1;
      prev = cur;
    }
    return prev[lb];
  }

  function typoHit(token, field) {
    if (!token || !field.expanded || isDigits(token) || token.length < 5) return false;
    const maxDist = token.length >= 8 ? 2 : 1;
    return wordsOf(field.expanded).some((word) => {
      if (!word || isDigits(word) || word.length < 5) return false;
      if (Math.abs(word.length - token.length) > maxDist) return false;
      const dist = levenshteinWithin(token, word, maxDist);
      return dist > 0 && dist <= maxDist;
    });
  }

  function synonymNeedles(token) {
    if (!token || isDigits(token)) return [];
    const tokenStem = stemRu(token);
    const needles = [];
    const seen = new Set();
    for (const group of SYNONYM_GROUPS) {
      const belongs = group.some((lemma) => {
        if (lemma === token) return true;
        const lemmaStem = stemRu(lemma);
        if (stemsMatch(tokenStem, lemmaStem) || stemsMatch(tokenStem, lemma) || stemsMatch(token, lemmaStem)) {
          return true;
        }
        if (token.length >= MIN_PREFIX_LEN && lemma.length >= MIN_PREFIX_LEN) {
          return lemma.startsWith(token) || token.startsWith(lemma);
        }
        return false;
      });
      if (!belongs) continue;
      for (const lemma of group) {
        if (lemma === token || seen.has(lemma)) continue;
        seen.add(lemma);
        needles.push(lemma);
      }
    }
    return needles;
  }

  function absenceHit(token, field) {
    if (!ABSENCE_QUERY.has(token) || !field.expanded) return { hit: false, exactWord: false };
    const words = wordsOf(field.expanded);
    return {
      hit: words.some((word) => ABSENCE_FIELD.has(word)),
      exactWord: words.some((word) => word === token),
    };
  }

  function applyMech(mech, token, field, fieldKey) {
    if (!field?.expanded) return { hit: false, exactWord: false };
    if (mech === 'exact') {
      const hit = exactOrPrefix(token, field);
      return { hit, exactWord: hit && isExactWord(token, field) };
    }
    if (mech === 'stem') return { hit: stemHit(token, field, fieldKey), exactWord: false };
    if (mech === 'synonym') {
      let hit = false;
      let exactWord = false;
      for (const needle of synonymNeedles(token)) {
        if (!(exactOrPrefix(needle, field) || stemHit(needle, field, fieldKey))) continue;
        hit = true;
        if (isExactWord(needle, field)) exactWord = true;
      }
      const absence = absenceHit(token, field);
      if (absence.hit) {
        hit = true;
        if (absence.exactWord) exactWord = true;
      }
      return { hit, exactWord };
    }
    if (mech === 'typo') return { hit: typoHit(token, field), exactWord: false };
    return { hit: false, exactWord: false };
  }

  function matchToken(token, maps, options = {}) {
    const suggest = options.suggest === true;
    const mechs = suggest ? ['exact', 'stem', 'synonym'] : ['exact', 'stem', 'synonym', 'typo'];
    for (const mech of mechs) {
      let best = 0;
      let any = false;
      let title = false;
      for (const [key, field] of Object.entries(maps)) {
        const res = applyMech(mech, token, field, key);
        if (!res.hit) continue;
        any = true;
        const weight = field.weight + (res.exactWord ? 8 : 0);
        if (weight > best) best = weight;
        if (key === 'title') title = true;
      }
      if (any) return { weight: best, mechanism: mech, title };
    }
    if (suggest && token.length >= 5) {
      let best = 0;
      let any = false;
      let title = false;
      for (const key of SUGGEST_TYPO_FIELD_KEYS) {
        const field = maps[key];
        if (!field) continue;
        const res = applyMech('typo', token, field, key);
        if (!res.hit) continue;
        any = true;
        const weight = field.weight + (res.exactWord ? 8 : 0);
        if (weight > best) best = weight;
        if (key === 'title') title = true;
      }
      if (any) return { weight: best, mechanism: 'typo', title };
    }
    return null;
  }

  function quickSuggestItemHit(item, token, phrases) {
    const fields = registryFields(item);
    const title = normalize(fields.title);
    const description = normalize(fields.description || '');
    if ((phrases || []).some((phrase) => title.includes(phrase) || description.includes(phrase))) {
      return true;
    }
    if (!token) return false;
    if (title.includes(token) || description.includes(token)) return true;
    if (token.length >= MIN_PREFIX_LEN) {
      const titleWords = title ? title.split(' ') : [];
      if (titleWords.some((w) => w.startsWith(token) || token.startsWith(w))) return true;
    }
    for (const needle of synonymNeedles(token)) {
      if (title.includes(needle) || description.includes(needle)) return true;
    }
    if (token.length >= 9) {
      const root = stemRuCached(token).slice(0, 7);
      if (root.length >= 6) {
        const titleWords = title ? title.split(' ') : [];
        if (
          titleWords.some((w) => w.startsWith(root) || stemRuCached(w).startsWith(root)) ||
          (description && description.includes(root))
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function descriptionTokenHit(token, field) {
    if (!field?.expanded) return false;
    if (applyMech('exact', token, field, 'description').hit) return true;
    if (applyMech('stem', token, field, 'description').hit) return true;
    return applyMech('synonym', token, field, 'description').hit;
  }

  function phraseScore(phrase, maps) {
    let best = 0;
    let hit = false;
    for (const field of Object.values(maps)) {
      if (!phrase || !field.expanded || !field.expanded.includes(phrase)) continue;
      hit = true;
      const exact = wordsOf(field.expanded).some((word) => word === phrase);
      best = Math.max(best, field.weight + (exact ? 8 : 0));
    }
    return hit ? best : -1;
  }

  function suggestTokens(parsed) {
    const tokens = [];
    const weak = [];
    const seen = new Set();
    for (const token of parsed.tokens) {
      if (!token || STOP_WORDS.has(token) || seen.has(token)) continue;
      seen.add(token);
      if (SUGGEST_WEAK_TOKENS.has(token)) weak.push(token);
      else tokens.push(token);
    }
    return { tokens, weak };
  }

  function suggestRegistry(items, query, { placeCounts } = {}) {
    const parsed = parseQuery(query);
    const { tokens, weak } = suggestTokens(parsed);
    if (!parsed.phrases.length && !tokens.length && !weak.length) {
      return { empty: true, ranked: [] };
    }

    const counts = placeCounts || {};
    const ranked = [];
    let pool = items || [];
    if (tokens.length || parsed.phrases.length) {
      const filtered = pool.filter((item) => {
        if (parsed.phrases.some((phrase) => quickSuggestItemHit(item, '', [phrase]))) return true;
        return tokens.some((token) => quickSuggestItemHit(item, token, parsed.phrases));
      });
      if (filtered.length) pool = filtered;
    }
    for (const item of pool) {
      const { maps } = buildFieldMaps(registryFields(item), fieldWeightsRegistry());
      let matched = 0;
      let weightSum = 0;
      let phraseMiss = false;
      for (const phrase of parsed.phrases) {
        const part = phraseScore(phrase, maps);
        if (part < 0) {
          phraseMiss = true;
          break;
        }
        matched += 1;
        weightSum += part;
      }
      if (phraseMiss) continue;

      let typo = false;
      let synonym = false;
      let allInTitle = tokens.length > 1;
      for (const token of tokens) {
        const hit = matchToken(token, maps, { suggest: true });
        if (!hit) {
          allInTitle = false;
          continue;
        }
        matched += 1;
        weightSum += hit.weight;
        if (!hit.title) allInTitle = false;
        if (hit.mechanism === 'typo') typo = true;
        if (hit.mechanism === 'synonym') synonym = true;
      }
      for (const token of weak) {
        const hit = matchToken(token, maps, { suggest: true });
        if (hit) weightSum += hit.weight * 0.35;
      }

      const required = parsed.phrases.length + tokens.length;
      if (!matched || matched < 1) continue;
      const full = matched === required;
      let score = full
        ? weightSum + (allInTitle ? 25 : 0)
        : weightSum * (matched / required) * 0.55;

      const reasons = [];
      if (typo) reasons.push('исправлена опечатка');
      if (synonym) reasons.push('синоним');
      const titleKey = normalize(item?.title);
      const placeCount = Number(counts[titleKey] || 0);
      if (titleKey && placeCount >= 1) {
        score += PLACE_BONUS;
        reasons.push('часто в этом месте');
      }
      if (tokens.length >= 2 && maps.description) {
        let descHits = 0;
        for (const token of tokens) {
          if (descriptionTokenHit(token, maps.description)) descHits += 1;
        }
        if (descHits === tokens.length) {
          score += DESCRIPTION_ALL_TOKENS_BONUS;
          reasons.push('описание в реестре');
        }
      }

      ranked.push({ item, score, matched, required, full, reasons });
    }

    ranked.sort(
      (a, b) =>
        (a.full === b.full ? 0 : a.full ? -1 : 1) ||
        b.matched - a.matched ||
        b.score - a.score ||
        (a.item.number || 0) - (b.item.number || 0)
    );
    return { empty: false, ranked: ranked.slice(0, MAX_RESULTS) };
  }

  function shouldShowLeader(ranked) {
    if (!ranked || !ranked.length) return false;
    const leader = ranked[0];
    if (!leader.full || !(leader.score > 0)) return false;
    if (ranked.length === 1) return true;
    const second = ranked[1];
    return leader.score >= second.score * LEADER_SCORE_RATIO;
  }

  function bindPhotoHint(pred, items) {
    const title = pred?.violationTitle;
    if (title) {
      const exact = items.find((item) => item?.title === title);
      if (exact) return exact;
      const key = normalize(title);
      if (key) {
        const folded = items.find((item) => normalize(item?.title) === key);
        if (folded) return folded;
      }
    }
    if (pred?.registryOrderNumber != null && pred.registryOrderNumber !== '') {
      return items.find((item) => item?.number === pred.registryOrderNumber) || null;
    }
    return null;
  }

  function mapPhotoHints(predictions, registryItems) {
    const items = registryItems || [];
    const kept = [];
    for (const pred of predictions || []) {
      const confidence = Number(pred?.confidence);
      if (!(confidence >= PHOTO_HINT_MIN_ITEM)) continue;
      kept.push({ pred, confidence });
    }
    if (!kept.length) return [];
    let best = kept[0].confidence;
    for (const row of kept) {
      if (row.confidence > best) best = row.confidence;
    }
    if (best < PHOTO_HINT_MIN_TOP) return [];
    kept.sort((a, b) => b.confidence - a.confidence);
    const hints = [];
    for (const row of kept.slice(0, 4)) {
      const item = bindPhotoHint(row.pred, items);
      if (!item) continue;
      hints.push({
        item,
        confidence: row.confidence,
        percent: Math.round(row.confidence * 100),
      });
    }
    return hints;
  }

  return {
    normalize,
    parseQuery,
    filterRegistry,
    filterActViolations,
    placesMatch,
    suggestRegistry,
    shouldShowLeader,
    mapPhotoHints,
    MAX_RESULTS,
    LEADER_SCORE_RATIO,
    PLACE_BONUS,
    PHOTO_HINT_MIN_ITEM,
    PHOTO_HINT_MIN_TOP,
    STOP_WORDS,
    SYNONYM_GROUPS,
  };
})();
