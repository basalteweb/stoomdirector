window.AU = window.AU || {};

AU.util = (() => {
  const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const moneyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
  const numberFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const intFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const pctFmt = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normText(value) {
    return cleanText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[^A-Z0-9@.+\-' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normEmail(value) {
    return cleanText(value).toLowerCase().replace(/\s+/g, '');
  }

  function normPhone(value) {
    let s = cleanText(value).replace(/\.0$/, '').replace(/[^0-9+]/g, '');
    if (!s) return '';
    if (s.startsWith('0033')) s = '0' + s.slice(4);
    else if (s.startsWith('+33')) s = '0' + s.slice(3);
    else if (s.startsWith('33') && s.length === 11) s = '0' + s.slice(2);
    if (!s.startsWith('0') && s.length === 9 && /^[67]/.test(s)) s = '0' + s;
    return s;
  }

  function normPostal(value) {
    let s = cleanText(value).replace(/\.0$/, '').replace(/\D/g, '');
    if (!s) return '';
    return s.padStart(5, '0').slice(0, 5);
  }

  function normArticleCode(value) {
    let s = cleanText(value).replace(/\.0$/, '');
    return s;
  }

  function looseArticleCode(value) {
    const s = normArticleCode(value);
    if (!s) return '';
    const stripped = s.replace(/^0+(?=\d)/, '');
    return stripped || '0';
  }

  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const s = cleanText(value);
    if (!s) return 0;
    const normalized = s
      .replace(/\s/g, '')
      .replace(/€/g, '')
      .replace(/%/g, '')
      .replace(/,(?=\d{1,6}$)/, '.')
      .replace(/[^0-9+\-.]/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }

  function toNullableNumber(value) {
    const s = cleanText(value);
    if (!s) return null;
    const normalized = s.replace(/[\s€%]/g, '').replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  function parseTgmDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Excel serial date. Epoch adjusted for Excel 1900 system.
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const s = cleanText(value);
    if (!s) return null;
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*-?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
      return Number.isNaN(d.getTime()) || d.getFullYear() !== Number(m[3]) || d.getMonth() !== Number(m[2])-1 || d.getDate() !== Number(m[1]) || d.getHours() !== Number(m[4]||0) || d.getMinutes() !== Number(m[5]||0) || d.getSeconds() !== Number(m[6]||0) ? null : d;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
      return Number.isNaN(d.getTime()) || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2])-1 || d.getDate() !== Number(m[3]) || d.getHours() !== Number(m[4]||0) || d.getMinutes() !== Number(m[5]||0) || d.getSeconds() !== Number(m[6]||0) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function startOfDay(date) {
    if (!date) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function endOfDay(date) {
    if (!date) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  function dateKey(date) {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function monthKey(date) {
    return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : '';
  }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function median(values) {
    const arr = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!arr.length) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }

  function mean(values) {
    const arr = values.filter(Number.isFinite);
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  }

  function sum(values) {
    return values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pctChange(current, previous) {
    if (!Number.isFinite(previous) || previous === 0) return null;
    return (current - previous) / Math.abs(previous);
  }

  function escapeHtml(value) {
    return cleanText(value).replace(/[&<>'"]/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
  }

  function money(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : moneyFmt.format(Number(value)); }
  function number(value) { return numberFmt.format(Number(value) || 0); }
  function integer(value) { return intFmt.format(Number(value) || 0); }
  function percent(value) { return Number.isFinite(value) ? pctFmt.format(value) : '—'; }
  function formatDate(value) { return value instanceof Date && !Number.isNaN(value.getTime()) ? dateFmt.format(value) : '—'; }
  function formatDateTime(value) { return value instanceof Date && !Number.isNaN(value.getTime()) ? dateTimeFmt.format(value) : '—'; }

  function humanDays(days) {
    if (!Number.isFinite(days)) return '—';
    if (Math.abs(days) < 1) return 'aujourd’hui';
    return `${Math.round(days)} j`;
  }

  function sortFrench(a, b) { return collator.compare(String(a ?? ''), String(b ?? '')); }

  function unique(values) { return [...new Set(values)]; }

  function groupBy(items, keyFn) {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  function indexByMulti(items, keyFn) {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  function uniqueIndex(items, keyFn) {
    const multi = indexByMulti(items, keyFn);
    const uniqueMap = new Map();
    const ambiguous = new Map();
    for (const [key, vals] of multi) {
      if (vals.length === 1) uniqueMap.set(key, vals[0]);
      else ambiguous.set(key, vals);
    }
    return { unique: uniqueMap, ambiguous };
  }

  function inRange(date, from, to) {
    if (!date) return false;
    const t = date.getTime();
    return (!from || t >= from.getTime()) && (!to || t <= to.getTime());
  }

  function easterSunday(year) {
    const f = Math.floor;
    const G = year % 19;
    const C = f(year / 100);
    const H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30;
    const I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11));
    const J = (year + f(year / 4) + I + 2 - C + f(C / 4)) % 7;
    const L = I - J;
    const month = 3 + f((L + 40) / 44);
    const day = L + 28 - 31 * f(month / 4);
    return new Date(year, month - 1, day);
  }

  function frenchPublicHoliday(date) {
    if (!date) return null;
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const fixed = AU.FRENCH_PUBLIC_HOLIDAYS_FIXED.find(x => x.month === m && x.day === d);
    if (fixed) return fixed.name;
    const easter = easterSunday(date.getFullYear());
    const movable = [
      { offset: 1, name: 'Lundi de Pâques' },
      { offset: 39, name: 'Ascension' },
      { offset: 50, name: 'Lundi de Pentecôte' }
    ];
    for (const item of movable) {
      const hd = addDays(easter, item.offset);
      if (dateKey(hd) === dateKey(date)) return item.name;
    }
    return null;
  }

  function schoolHoliday(date) {
    if (!date) return null;
    const key = dateKey(date);
    return AU.SCHOOL_HOLIDAYS_ZONE_A.find(h => key >= h.start && key <= h.end) || null;
  }

  function periodMeta(date) {
    const school = schoolHoliday(date);
    const publicHoliday = frenchPublicHoliday(date);
    return {
      schoolHoliday: school ? school.name : null,
      isSchoolHoliday: Boolean(school),
      publicHoliday,
      isPublicHoliday: Boolean(publicHoliday),
      isWeekend: date ? [0, 6].includes(date.getDay()) : false,
      dayOfWeek: date ? date.getDay() : null,
      hour: date ? date.getHours() : null,
      month: date ? date.getMonth() + 1 : null,
      year: date ? date.getFullYear() : null,
      monthKey: monthKey(date),
      dateKey: dateKey(date)
    };
  }

  function fileBase(name) {
    const clean = cleanText(name).toLowerCase();
    return clean.replace(/\.[^.]+$/, '').replace(/[\s_-]+/g, '');
  }

  function filenameMatches(name, type) {
    const rule = AU.FILE_RULES[type];
    if (!rule) return false;
    const ext = cleanText(name).toLowerCase().split('.').pop();
    if (!rule.extensions.includes(ext)) return false;
    const stem = cleanText(name).toLowerCase().replace(/\.[^.]+$/, '');
    const normalized = stem.replace(/\s+/g, '');
    return new RegExp(`^${rule.baseName}(?:\\(\\d+\\)|\\d+|[_-]\\d+)?$`, 'i').test(normalized);
  }

  function stableStringify(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
  }

  async function hashString(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvEscape(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(rows, columns) {
    const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
    const lines = [cols.map(csvEscape).join(';')];
    for (const row of rows) lines.push(cols.map(c => csvEscape(row[c])).join(';'));
    return '\uFEFF' + lines.join('\r\n');
  }

  return {
    cleanText, normText, normEmail, normPhone, normPostal, normArticleCode, looseArticleCode,
    toNumber, toNullableNumber, parseTgmDate, startOfDay, endOfDay, dateKey, monthKey,
    daysBetween, addDays, median, mean, sum, clamp, pctChange, escapeHtml, money, number,
    integer, percent, formatDate, formatDateTime, humanDays, sortFrench, unique, groupBy,
    indexByMulti, uniqueIndex, inRange, easterSunday, frenchPublicHoliday, schoolHoliday,
    periodMeta, filenameMatches, stableStringify, hashString, downloadText, toCsv
  };
})();
