'use strict';

/* ===== やさしいカレンダー script.js =====
   できること
   ・月のカレンダー表示 と、上から順に並ぶ「一覧表示」(祝日は holidays.js が自動で計算)
   ・「休み」と「印(○×△)」を、まとめて付ける
   ・日付ごとに「予定メモ」を書く
   ・条件を選んで、一覧を書き出す(コピー)

   保存のしかた
   ・ブラウザの localStorage に、この形で保存します
     { "2026-11-03": { rest: true, marks: ["maru"], text: "ごはん会" }, ... }
     (text が「予定メモ」の中身です)
   ・外部には一切送りません。
   ※ dateKey / getHolidayName などは holidays.js にあります。
*/

const STORAGE_KEY = 'easyCalendarData';
const VIEW_KEY = 'easyCalendarView'; // 最後に使った表示(カレンダー/一覧)を覚えておく
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 印の一覧(画面に出す順番も、この順)。symbol は画面に出す文字。
// 印の意味(眼科の日、歯医者の日など)は、使う人が自由に決めます。
// 1日に、いくつ重ねて付けてもOKです。
const MARKS = [
  { id: 'maru',    symbol: '○' },
  { id: 'batsu',   symbol: '×' },
  { id: 'sankaku', symbol: '△' },
];
const MARK_BY_ID = {};
MARKS.forEach(m => { MARK_BY_ID[m.id] = m; });

/* ---------- 画面の部品を取ってくる ---------- */
const $ = id => document.getElementById(id);
const grid = $('grid');
const dayList = $('dayList');
const weekdays = $('weekdays');
const viewButtons = document.querySelectorAll('.view-btn');
const monthTitle = $('monthTitle');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const modeHint = $('modeHint');
const modeButtons = $('modeButtons');
const toast = $('toast');

const memoOverlay = $('memoOverlay');
const memoTitle = $('memoTitle');
const memoSub = $('memoSub');
const memoText = $('memoText');

const exportOverlay = $('exportOverlay');
const exFrom = $('exFrom');
const exTo = $('exTo');
const exChecks = $('exChecks');
const exText = $('exText');
const exMessage = $('exMessage');
const exResult = $('exResult');
const exCopy = $('exCopy');

const helpOverlay = $('helpOverlay');

/* ---------- いまの状態 ---------- */
let viewYear;              // 表示中の年
let viewMonth;             // 表示中の月(1〜12)
let view = loadView();     // 'calendar'=カレンダー表示 / 'list'=一覧表示
let mode = 'write';        // 'write'=予定メモ / 'rest'=休み / 印のid
let editingKey = null;     // 予定メモを書いている日 ("2026-11-03")
let activeOverlay = null;  // 開いているポップアップ
let toastTimer = null;
let storageWarned = false;
let data = loadData();

/* ---------- 小さな道具 ---------- */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContentなので、書いた文字がプログラムとして動くことはない
  return node;
}

function todayKey() {
  return keyOfDate(new Date());
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

/* ---------- 保存と読み込み ---------- */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // 想定外の形(こわれたデータ)のときは、空から始める
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {
    // 読めなかったら、空から始める(画面が真っ白にならないように)
  }
  return {};
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    if (!storageWarned) {
      storageWarned = true;
      showToast('保存できませんでした。ブラウザの設定を確かめてください。');
    }
  }
}

function loadView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar';
  } catch (e) {
    return 'calendar';
  }
}

function saveView() {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (e) {
    // 保存できなくても、アプリは普通に使える
  }
}

// 1日分のデータを、必ず { rest, marks, text } の形にそろえる
function normalize(entry) {
  const result = { rest: false, marks: [], text: '' };
  if (entry && typeof entry === 'object') {
    result.rest = entry.rest === true;
    if (Array.isArray(entry.marks)) {
      // MARKSの順番で並べ直す(表示がいつも同じ順になる)。知らない印は無視する
      result.marks = MARKS.map(m => m.id).filter(id => entry.marks.includes(id));
    }
    if (typeof entry.text === 'string') result.text = entry.text;
  }
  return result;
}

// 1日分のデータを変更して保存する。何も無くなった日は、記録ごと消す
function updateDay(key, change) {
  const entry = normalize(data[key]);
  change(entry);
  if (entry.rest || entry.marks.length > 0 || entry.text !== '') {
    data[key] = entry;
  } else {
    delete data[key];
  }
  saveData();
}

/* ---------- 表示(カレンダー / 一覧) ---------- */
function describeDay(year, month, day, dow, holiday, entry) {
  let s = `${month}月${day}日${WEEKDAYS[dow]}曜日`;
  if (holiday) s += '、' + holiday;
  if (entry.rest) s += '、休み';
  if (entry.marks.length > 0) s += '、印 ' + entry.marks.map(id => MARK_BY_ID[id].symbol).join('');
  if (entry.text !== '') s += '、予定メモあり';
  return s;
}

function firstLine(text) {
  const line = text.split(/\r?\n/).find(l => l.trim() !== '');
  return line || '';
}

// カレンダー表示: 1日分のマス(ボタン)を作る
function createDayCell(year, month, day) {
  const key = dateKey(year, month, day);
  const dow = new Date(year, month - 1, day).getDay();
  const entry = normalize(data[key]);
  const holiday = getHolidayName(year, month, day);

  const btn = el('button', 'day');
  btn.type = 'button';
  btn.dataset.key = key;
  if (dow === 0) btn.classList.add('sun');
  if (dow === 6) btn.classList.add('sat');
  if (holiday) btn.classList.add('holiday');
  if (entry.rest) btn.classList.add('rest');
  if (key === todayKey()) btn.classList.add('today');

  btn.appendChild(el('span', 'day-num', String(day)));
  if (entry.rest) btn.appendChild(el('span', 'day-tag', '休'));
  if (holiday) btn.appendChild(el('span', 'holiday-name', getHolidayShortName(holiday)));

  if (entry.marks.length > 0) {
    const row = el('span', 'marks');
    entry.marks.forEach(id => {
      row.appendChild(el('span', 'mark-sym mark-' + id, MARK_BY_ID[id].symbol));
    });
    btn.appendChild(row);
  }

  if (entry.text !== '') btn.appendChild(el('span', 'memo-preview', firstLine(entry.text)));

  btn.setAttribute('aria-label', describeDay(year, month, day, dow, holiday, entry));
  return btn;
}

// 一覧表示: 1日分の行(ボタン)を作る
function createDayRow(year, month, day) {
  const key = dateKey(year, month, day);
  const dow = new Date(year, month - 1, day).getDay();
  const entry = normalize(data[key]);
  const holiday = getHolidayName(year, month, day);

  const btn = el('button', 'row');
  btn.type = 'button';
  btn.dataset.key = key;
  if (dow === 0) btn.classList.add('sun');
  if (dow === 6) btn.classList.add('sat');
  if (holiday) btn.classList.add('holiday');
  if (entry.rest) btn.classList.add('rest');
  if (key === todayKey()) btn.classList.add('today');

  // 左: 日にちと曜日
  const date = el('span', 'row-date');
  date.appendChild(el('span', 'row-day', String(day)));
  date.appendChild(el('span', 'row-dow', WEEKDAYS[dow]));
  btn.appendChild(date);

  // 右: 休み・祝日名・印 と、予定メモ
  const body = el('span', 'row-body');
  if (entry.rest || holiday || entry.marks.length > 0) {
    const tags = el('span', 'row-tags');
    if (entry.rest) tags.appendChild(el('span', 'row-rest', '休み'));
    if (holiday) tags.appendChild(el('span', 'row-holiday', holiday));
    if (entry.marks.length > 0) {
      const marks = el('span', 'row-marks');
      entry.marks.forEach(id => {
        marks.appendChild(el('span', 'mark-sym mark-' + id, MARK_BY_ID[id].symbol));
      });
      tags.appendChild(marks);
    }
    body.appendChild(tags);
  }
  if (entry.text !== '') body.appendChild(el('span', 'row-memo', entry.text));
  btn.appendChild(body);

  btn.setAttribute('aria-label', describeDay(year, month, day, dow, holiday, entry));
  return btn;
}

function renderGridView() {
  grid.innerHTML = '';
  const startOffset = new Date(viewYear, viewMonth - 1, 1).getDay(); // 1日の曜日
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const day = i - startOffset + 1;
    if (day < 1 || day > daysInMonth) {
      grid.appendChild(el('div', 'day-empty'));
    } else {
      grid.appendChild(createDayCell(viewYear, viewMonth, day));
    }
  }
}

function renderListView() {
  dayList.innerHTML = '';
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    dayList.appendChild(createDayRow(viewYear, viewMonth, day));
  }

  // 一覧の一番下にも「前の月・次の月」を置く(上までもどらなくていいように)
  const nav = el('div', 'list-nav');
  const prev = el('button', 'nav-btn', '＜ 前の月');
  prev.type = 'button';
  prev.disabled = prevBtn.disabled;
  prev.addEventListener('click', () => moveMonth(-1));
  const next = el('button', 'nav-btn', '次の月 ＞');
  next.type = 'button';
  next.disabled = nextBtn.disabled;
  next.addEventListener('click', () => moveMonth(1));
  nav.appendChild(prev);
  nav.appendChild(next);
  dayList.appendChild(nav);
}

// 表示している月を、全部つくり直す(いまの表示=カレンダー/一覧 に合わせて)
function renderCalendar() {
  monthTitle.textContent = `${viewYear}年${viewMonth}月`;
  prevBtn.disabled = (viewYear === HOLIDAY_MIN_YEAR && viewMonth === 1);
  nextBtn.disabled = (viewYear === HOLIDAY_MAX_YEAR && viewMonth === 12);

  const isList = view === 'list';
  weekdays.hidden = isList;
  grid.hidden = isList;
  dayList.hidden = !isList;
  viewButtons.forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  if (isList) renderListView();
  else renderGridView();
}

// 1日分だけ作り直す(印つけ中の動きを軽くするため)
function refreshCell(key) {
  const isList = view === 'list';
  const old = (isList ? dayList : grid).querySelector(`[data-key="${key}"]`);
  if (!old) return;
  const parts = key.split('-').map(Number);
  old.replaceWith(isList ? createDayRow(parts[0], parts[1], parts[2]) : createDayCell(parts[0], parts[1], parts[2]));
}

// 一覧表示では「今日」の行が見える位置へ。それ以外は先頭へ
function scrollToFocus() {
  if (view === 'list') {
    const today = dayList.querySelector('.row.today');
    if (today) {
      today.scrollIntoView({ block: 'center' });
      return;
    }
  }
  window.scrollTo(0, 0);
}

function moveMonth(delta) {
  let y = viewYear;
  let m = viewMonth + delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  if (y < HOLIDAY_MIN_YEAR || y > HOLIDAY_MAX_YEAR) return;
  viewYear = y;
  viewMonth = m;
  renderCalendar();
  if (view === 'list') window.scrollTo(0, 0);
}

function goToday() {
  const now = new Date();
  viewYear = Math.min(Math.max(now.getFullYear(), HOLIDAY_MIN_YEAR), HOLIDAY_MAX_YEAR);
  viewMonth = now.getMonth() + 1;
  renderCalendar();
  scrollToFocus();
}

function setView(newView) {
  view = newView === 'list' ? 'list' : 'calendar';
  saveView();
  renderCalendar();
  scrollToFocus();
}

/* ---------- 画面下の操作バー(モード切り替え) ---------- */
function buildToolbar() {
  const items = [{ mode: 'write', label: '予定メモ' }, { mode: 'rest', label: '休み' }]
    .concat(MARKS.map(m => ({ mode: m.id, label: m.symbol, isMark: true })));

  items.forEach(item => {
    const btn = el('button', 'mode-btn');
    btn.type = 'button';
    btn.dataset.mode = item.mode;
    btn.setAttribute('aria-pressed', 'false');
    if (item.isMark) {
      btn.appendChild(el('span', 'mark-sym mark-' + item.mode, item.label));
      btn.setAttribute('aria-label', '印 ' + item.label);
    } else {
      btn.textContent = item.label;
    }
    modeButtons.appendChild(btn);
  });
}

function hintText() {
  if (mode === 'write') return '日にちをタップすると、予定メモを書けます。';
  const name = mode === 'rest' ? '休み' : MARK_BY_ID[mode].symbol;
  return `「${name}」を付けています。日にちをタップ(もう一度で取り消し)。終わったら「予定メモ」を押します。`;
}

function setMode(newMode) {
  mode = newMode;
  document.body.dataset.mode = mode;
  modeButtons.querySelectorAll('.mode-btn').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  modeHint.textContent = hintText();
}

/* ---------- 日にちをタップしたとき ---------- */
function handleDayTap(key) {
  if (mode === 'write') {
    openMemo(key);
    return;
  }

  if (mode === 'rest') {
    updateDay(key, e => { e.rest = !e.rest; });
  } else {
    // 印は、付いていれば外し、付いていなければ付ける(1日にいくつ重ねてもOK)
    updateDay(key, e => {
      e.marks = e.marks.includes(mode) ? e.marks.filter(id => id !== mode) : e.marks.concat(mode);
    });
  }
  refreshCell(key);
}

/* ---------- ポップアップの開け閉め ---------- */
function showOverlay(overlay) {
  if (activeOverlay) activeOverlay.hidden = true;
  activeOverlay = overlay;
  overlay.hidden = false;
  document.body.classList.add('modal-open');
  const sheet = overlay.querySelector('.sheet');
  overlay.scrollTop = 0;
  if (sheet) sheet.focus();
}

function closeOverlay() {
  if (!activeOverlay) return;
  activeOverlay.hidden = true;
  activeOverlay = null;
  editingKey = null;
  document.body.classList.remove('modal-open');
}

/* ---------- 予定メモを書く画面 ---------- */
function openMemo(key) {
  editingKey = key;
  const parts = key.split('-').map(Number);
  const dow = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  memoTitle.textContent = `${parts[0]}年${parts[1]}月${parts[2]}日(${WEEKDAYS[dow]})`;

  const entry = normalize(data[key]);
  const holiday = getHolidayName(parts[0], parts[1], parts[2]);
  const info = [];
  if (holiday) info.push('祝日: ' + holiday);
  if (entry.rest) info.push('休み');
  if (entry.marks.length > 0) info.push('印: ' + entry.marks.map(id => MARK_BY_ID[id].symbol).join(' '));
  memoSub.textContent = info.join('  /  ');
  memoSub.hidden = info.length === 0;

  memoText.value = entry.text;
  showOverlay(memoOverlay);
}

// 文字を入れるたびに、自動で保存する
memoText.addEventListener('input', () => {
  if (!editingKey) return;
  const value = memoText.value;
  updateDay(editingKey, e => { e.text = value.trim() === '' ? '' : value; });
  refreshCell(editingKey);
});

$('memoClose').addEventListener('click', closeOverlay);

$('memoClear').addEventListener('click', () => {
  if (!editingKey) return;
  if (!confirm('この日の「休み・印・予定メモ」を、すべて消します。よろしいですか?')) return;
  const key = editingKey;
  delete data[key];
  saveData();
  refreshCell(key);
  closeOverlay();
});

/* ---------- 書き出し ---------- */
// チェックできるのは「休み」と「印」。祝日の名前は、チェックなしで自動で入る
const EXPORT_ITEMS = [{ id: 'rest', label: '休み' }]
  .concat(MARKS.map(m => ({ id: m.id, label: m.symbol, isMark: true })));

function buildExportChecks() {
  EXPORT_ITEMS.forEach(item => {
    const label = el('label', 'check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.id;
    label.appendChild(input);
    label.appendChild(item.isMark ? el('span', 'mark-sym mark-' + item.id, item.label) : el('span', '', item.label));
    exChecks.appendChild(label);
  });
}

// "2026-11-03" → Date (形がちがうときは null)
function parseDateInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// CSV(カンマ区切り)の1マス分。カンマ・改行・"が入るときは"で囲む
function csvCell(value) {
  const s = String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function refreshExport() {
  exResult.value = '';
  exCopy.disabled = true;

  const checkedIds = Array.from(exChecks.querySelectorAll('input:checked'), i => i.value);
  if (checkedIds.length === 0) {
    exMessage.textContent = '出したい日にチェックを付けてください。';
    return;
  }

  const from = parseDateInput(exFrom.value);
  const to = parseDateInput(exTo.value);
  if (!from || !to) {
    exMessage.textContent = '期間の日付を入れてください。';
    return;
  }
  if (from > to) {
    exMessage.textContent = '開始の日が、終了の日より後になっています。';
    return;
  }
  const days = Math.round((to - from) / 86400000) + 1;
  if (days > 3660) {
    exMessage.textContent = '期間は10年以内にしてください。';
    return;
  }

  const wantRest = checkedIds.includes('rest');                 // 「休み」にチェックがあるか
  const markIds = checkedIds.filter(id => id !== 'rest');       // チェックされた印
  const withText = exText.checked;

  // 列は「チェックした項目」だけ。祝日の列は、名前が自動で入る
  const header = ['日付', '曜日'];
  if (wantRest) header.push('休み');
  header.push('祝日');
  if (markIds.length > 0) header.push('印');
  if (withText) header.push('予定メモ');

  const lines = [header.map(csvCell).join(',')];
  let count = 0;

  for (let i = 0; i < days; i++) {
    const dt = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const y = dt.getFullYear();
    const m = dt.getMonth() + 1;
    const d = dt.getDate();
    const entry = normalize(data[dateKey(y, m, d)]);
    const holiday = getHolidayName(y, m, d);

    // 出す日: 「休み」にチェックして休みの日 / チェックした印が付いている日
    const hit = (wantRest && entry.rest) || entry.marks.some(id => markIds.includes(id));
    if (!hit) continue;

    count++;
    const row = [`${y}/${m}/${d}`, WEEKDAYS[dt.getDay()]];
    if (wantRest) row.push(entry.rest ? '休み' : '');
    row.push(holiday);
    if (markIds.length > 0) {
      // その日の印のうち、チェックした印だけを出す
      row.push(entry.marks.filter(id => markIds.includes(id)).map(id => MARK_BY_ID[id].symbol).join(''));
    }
    if (withText) row.push(entry.text);
    lines.push(row.map(csvCell).join(','));
  }

  if (count === 0) {
    exMessage.textContent = '当てはまる日がありません。';
    return;
  }
  exMessage.textContent = `${count}日分あります。`;
  exResult.value = lines.join('\n');
  exCopy.disabled = false;
}

function openExport() {
  // 開くたびに、期間は「今年の1月1日〜12月31日」にしておく
  const year = new Date().getFullYear();
  exFrom.value = dateKey(year, 1, 1);
  exTo.value = dateKey(year, 12, 31);
  refreshExport();
  showOverlay(exportOverlay);
}

async function copyExport() {
  const text = exResult.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('コピーしました。');
    return;
  } catch (e) {
    // 古いブラウザ向け: 文字を選択してコピー
  }
  exResult.focus();
  exResult.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  showToast(ok ? 'コピーしました。' : 'コピーできませんでした。文字を長押ししてコピーしてください。');
}

exportOverlay.addEventListener('input', refreshExport);
exportOverlay.addEventListener('change', refreshExport);
exCopy.addEventListener('click', copyExport);
$('exClose').addEventListener('click', closeOverlay);

/* ---------- 使い方の画面 ---------- */
$('helpClose').addEventListener('click', closeOverlay);

/* ---------- ボタンとイベントをつなぐ ---------- */
grid.addEventListener('click', e => {
  const cell = e.target.closest('.day');
  if (cell) handleDayTap(cell.dataset.key);
});

dayList.addEventListener('click', e => {
  const row = e.target.closest('.row');
  if (row) handleDayTap(row.dataset.key);
});

document.querySelector('.view-switch').addEventListener('click', e => {
  const btn = e.target.closest('.view-btn');
  if (btn) setView(btn.dataset.view);
});

modeButtons.addEventListener('click', e => {
  const btn = e.target.closest('.mode-btn');
  if (btn) setMode(btn.dataset.mode);
});

prevBtn.addEventListener('click', () => moveMonth(-1));
nextBtn.addEventListener('click', () => moveMonth(1));
$('todayBtn').addEventListener('click', goToday);
$('exportBtn').addEventListener('click', openExport);
$('helpBtn').addEventListener('click', () => showOverlay(helpOverlay));

// ポップアップの外側(黒い部分)をタップしたら閉じる。予定メモは自動保存済みなので安心
[memoOverlay, exportOverlay, helpOverlay].forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeOverlay();
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeOverlay();
});

// 日付が変わったあとにアプリへ戻ったとき、「今日」の印を更新する
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !activeOverlay) renderCalendar();
});

/* ---------- 起動 ---------- */
buildToolbar();
buildExportChecks();
setMode('write');
goToday();

/* ---------- オフライン対応 ---------- */
// アプリ本体をその機械に保存して、電波がなくても開けるようにする(sw.js)。
// https の公開ページ(と、練習用の localhost)でだけ働く。
// 登録できなくても、アプリは普通に使える。
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
