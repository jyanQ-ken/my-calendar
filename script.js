'use strict';

/* ===== My Calendar script.js =====
   できること
   ・月のカレンダー表示 と、上から順に並ぶ「一覧表示」(祝日は holidays.js が自動で計算)
   ・「休み」と「印(○×△)」を、まとめて付ける
   ・日付ごとに「予定メモ」を書く
   ・日付に関係なく長く残せる「メモ」(シートを自由に増やせる。チェック付きにもできる)
   ・条件を選んで、一覧を書き出す(コピー)

   保存のしかた
   ・ブラウザの localStorage に、この形で保存します
     { "2026-11-03": { rest: true, marks: ["maru"], text: "ごはん会" }, ... }
     (text が「予定メモ」の中身です)
   ・「メモ」(シート)は、別の場所 easyCalendarMemos に、この形で保存します
     { sheets: [{ id, name: "買い物", text: "牛乳\n✓ 卵", checklist: true }, ...], activeId }
     (チェックした行は、文章の頭に「✓ 」が付くだけ。だから、チェック付きを切り替えても内容は消えません)
   ・外部には一切送りません。
   ※ dateKey / getHolidayName などは holidays.js にあります。
*/

const STORAGE_KEY = 'easyCalendarData';
const VIEW_KEY = 'easyCalendarView'; // 最後に使った表示(カレンダー/一覧)を覚えておく
const MEMO_KEY = 'easyCalendarMemos'; // メモ(シート)の保存場所
const MAX_SHEETS = 20;                // シートは20枚まで
const MAX_SHEET_NAME = 20;            // シートの名前は20文字まで
const DONE_MARK = '✓ ';               // チェックした行の頭に付ける印
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

// メモ(シート)の部品
const memoView = $('memoView');
const sheetTabs = $('sheetTabs');
const sheetAdd = $('sheetAdd');
const sheetText = $('sheetText');
const sheetRows = $('sheetRows');
const sheetChecklist = $('sheetChecklist');
const sheetClearDone = $('sheetClearDone');
const sheetRename = $('sheetRename');
const sheetCopy = $('sheetCopy');
const sheetDelete = $('sheetDelete');

// シートの名前を入れる小さな画面
const nameOverlay = $('nameOverlay');
const nameTitle = $('nameTitle');
const nameInput = $('nameInput');

/* ---------- いまの状態 ---------- */
let viewYear;              // 表示中の年
let viewMonth;             // 表示中の月(1〜12)
let view = loadView();     // 'calendar'=月表示 / 'list'=一覧表示 / 'memo'=メモ
let mode = 'write';        // 'write'=予定メモ / 'rest'=休み / 印のid
let editingKey = null;     // 予定メモを書いている日 ("2026-11-03")
let activeOverlay = null;  // 開いているポップアップ
let toastTimer = null;
let storageWarned = false;
let data = loadData();
let memos = loadMemos();   // メモ(シート) { sheets: [...], activeId }
let nameMode = null;       // シートの名前を入れる画面の用途: 'add'(追加) / 'rename'(名前の変更)

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
    warnStorage();
  }
}

// 保存できなかったとき、最初の1回だけ知らせる
function warnStorage() {
  if (!storageWarned) {
    storageWarned = true;
    showToast('保存できませんでした。ブラウザの設定を確かめてください。');
  }
}

// 開いたときの表示。「メモ」は覚えない(いつも、月表示か一覧表示から始める)
function loadView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar';
  } catch (e) {
    return 'calendar';
  }
}

function saveView() {
  if (view === 'memo') return; // 「メモ」のときは、前の表示を覚えたままにする
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
  const isMemo = view === 'memo';
  // 月表示のときだけ、画面に固定して動かさない(CSSが html[data-view] を見て切り替える)
  document.documentElement.dataset.view = view;
  weekdays.hidden = view !== 'calendar';
  grid.hidden = view !== 'calendar';
  dayList.hidden = !isList;
  memoView.hidden = !isMemo;
  viewButtons.forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  if (isMemo) renderMemoView();
  else if (isList) renderListView();
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
  view = (newView === 'list' || newView === 'memo') ? newView : 'calendar';
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
  // 1行に収まる短さにする(画面下の操作バーを低くするため)
  if (mode === 'write') return '日にちをタップして、予定メモを書く';
  const name = mode === 'rest' ? '休み' : MARK_BY_ID[mode].symbol;
  return `「${name}」を付け中。終わったら「予定メモ」を押す`;
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

// 文字をコピーする。できたら true。(fallbackEl: 古いブラウザ向けに、文字を選択してコピーする入力欄)
async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 古いブラウザ向け: 文字を選択してコピー
  }
  const box = fallbackEl || document.createElement('textarea');
  if (!fallbackEl) {
    box.value = text;
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
  }
  box.focus();
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  if (!fallbackEl) box.remove();
  return ok;
}

async function copyExport() {
  const text = exResult.value;
  if (!text) return;
  const ok = await copyText(text, exResult);
  showToast(ok ? 'コピーしました。' : 'コピーできませんでした。文字を長押ししてコピーしてください。');
}

exportOverlay.addEventListener('input', refreshExport);
exportOverlay.addEventListener('change', refreshExport);
exCopy.addEventListener('click', copyExport);
$('exClose').addEventListener('click', closeOverlay);

/* ---------- メモ(日付に関係なく、長く残せる。シートを自由に増やせる) ---------- */
function newSheetId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function defaultMemos() {
  const id = newSheetId();
  return { sheets: [{ id: id, name: 'メモ', text: '', checklist: false }], activeId: id };
}

// 保存してあるメモを読む。こわれたデータのときは、空のメモ1枚から始める
function loadMemos() {
  try {
    const raw = localStorage.getItem(MEMO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sheets)) {
        const sheets = parsed.sheets
          .filter(s => s && typeof s === 'object')
          .slice(0, MAX_SHEETS)
          .map(s => ({
            id: (typeof s.id === 'string' && s.id) ? s.id : newSheetId(),
            name: (typeof s.name === 'string' && s.name.trim() !== '') ? s.name.trim().slice(0, MAX_SHEET_NAME) : 'メモ',
            text: typeof s.text === 'string' ? s.text : '',
            checklist: s.checklist === true,
          }));
        if (sheets.length > 0) {
          const activeId = sheets.some(s => s.id === parsed.activeId) ? parsed.activeId : sheets[0].id;
          return { sheets: sheets, activeId: activeId };
        }
      }
    }
  } catch (e) {
    // 読めなかったら、空のメモから始める(画面が真っ白にならないように)
  }
  return defaultMemos();
}

function saveMemos() {
  try {
    localStorage.setItem(MEMO_KEY, JSON.stringify(memos));
  } catch (e) {
    warnStorage();
  }
}

function activeSheet() {
  return memos.sheets.find(s => s.id === memos.activeId) || memos.sheets[0];
}

// 文章を行に分ける。頭に「✓」がある行は「チェック済み」
function parseLines(text) {
  return text.split('\n').map(line => {
    const m = /^✓\s?/.exec(line);
    return m ? { done: true, text: line.slice(m[0].length) } : { done: false, text: line };
  });
}

// シートのタブ(横に並ぶ)
function renderSheetTabs() {
  sheetTabs.innerHTML = '';
  memos.sheets.forEach(sheet => {
    const tab = el('button', 'sheet-tab', sheet.name);
    tab.type = 'button';
    tab.dataset.id = sheet.id;
    tab.setAttribute('role', 'tab');
    const active = sheet.id === memos.activeId;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    sheetTabs.appendChild(tab);
  });
  const current = sheetTabs.querySelector('.sheet-tab.active');
  if (current) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// チェック付きのときの、1行ぶん
function createRow(line) {
  const row = el('div', line.done ? 'check-row done' : 'check-row');
  const label = el('label', 'row-check');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = line.done;
  box.setAttribute('aria-label', '済み');
  label.appendChild(box);
  const input = document.createElement('textarea');
  input.className = 'row-text';
  input.rows = 1;
  input.value = line.text;
  input.setAttribute('aria-label', 'やること');
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

// 入力欄を、中の文字の量に合わせて高くする
function autoGrow(box) {
  box.style.height = 'auto';
  box.style.height = box.scrollHeight + 'px';
}

function renderRows() {
  sheetRows.innerHTML = '';
  parseLines(activeSheet().text).forEach(line => sheetRows.appendChild(createRow(line)));
  // リストの一番下: 「＋ 行を追加」と「済みを消す」
  const footer = el('div', 'row-footer');
  const add = el('button', 'row-add', '＋ 行を追加');
  add.type = 'button';
  footer.appendChild(add);
  footer.appendChild(sheetClearDone);
  sheetRows.appendChild(footer);
  sheetRows.querySelectorAll('.row-text').forEach(autoGrow);
}

// 画面の行 → 文章(チェックした行の頭に「✓ 」を付ける)
function rowsToText() {
  return Array.from(sheetRows.querySelectorAll('.check-row'), row => {
    const done = row.querySelector('input[type="checkbox"]').checked;
    const text = row.querySelector('.row-text').value.replace(/\r?\n/g, ' ');
    return (done ? DONE_MARK : '') + text;
  }).join('\n');
}

function saveRows() {
  activeSheet().text = rowsToText();
  saveMemos();
}

// 行を足す(rowの下。null なら一番下)。足した行に、すぐ書けるようにする
function addRowAfter(row) {
  const newRow = createRow({ done: false, text: '' });
  if (row) row.after(newRow);
  else sheetRows.insertBefore(newRow, sheetRows.querySelector('.row-footer'));
  const input = newRow.querySelector('.row-text');
  autoGrow(input);
  input.focus();
  saveRows();
}

function renderSheetBody() {
  const sheet = activeSheet();
  sheetChecklist.checked = sheet.checklist;
  sheetClearDone.hidden = !sheet.checklist;
  sheetText.hidden = sheet.checklist;
  sheetRows.hidden = !sheet.checklist;
  if (sheet.checklist) renderRows();
  else sheetText.value = sheet.text;
}

function renderMemoView() {
  renderSheetTabs();
  renderSheetBody();
}

// シートの名前を入れる小さな画面
function openNameDialog(mode) {
  if (mode === 'add' && memos.sheets.length >= MAX_SHEETS) {
    showToast(`シートは${MAX_SHEETS}枚までです。`);
    return;
  }
  nameMode = mode;
  nameTitle.textContent = mode === 'add' ? '新しいシートの名前' : 'シートの名前を変える';
  nameInput.value = mode === 'add' ? 'メモ' + (memos.sheets.length + 1) : activeSheet().name;
  showOverlay(nameOverlay);
  nameInput.focus();
  nameInput.select();
}

function submitName() {
  const name = nameInput.value.trim().slice(0, MAX_SHEET_NAME);
  if (name === '') {
    showToast('名前を入れてください。');
    return;
  }
  if (nameMode === 'add') {
    const sheet = { id: newSheetId(), name: name, text: '', checklist: false };
    memos.sheets.push(sheet);
    memos.activeId = sheet.id;
  } else if (nameMode === 'rename') {
    activeSheet().name = name;
  }
  nameMode = null;
  saveMemos();
  closeOverlay();
  renderMemoView();
}

function deleteSheet() {
  const sheet = activeSheet();
  if (!confirm(`シート「${sheet.name}」を消します。中身も消えます。よろしいですか?`)) return;
  const index = memos.sheets.indexOf(sheet);
  memos.sheets.splice(index, 1);
  if (memos.sheets.length === 0) {
    memos = defaultMemos(); // シートが1枚もなくならないようにする
  } else {
    memos.activeId = memos.sheets[Math.min(index, memos.sheets.length - 1)].id;
  }
  saveMemos();
  renderMemoView();
}

async function copySheet() {
  const sheet = activeSheet();
  if (sheet.text.trim() === '') {
    showToast('このシートは空です。');
    return;
  }
  const ok = await copyText(sheet.text);
  showToast(ok ? 'コピーしました。' : 'コピーできませんでした。');
}

// チェックした行を、まとめて消す
function clearDoneRows() {
  const sheet = activeSheet();
  const lines = parseLines(sheet.text);
  const doneCount = lines.filter(l => l.done).length;
  if (doneCount === 0) {
    showToast('チェックした行は、ありません。');
    return;
  }
  if (!confirm(`チェックした${doneCount}行を、消します。よろしいですか?`)) return;
  sheet.text = lines.filter(l => !l.done).map(l => l.text).join('\n');
  saveMemos();
  renderSheetBody();
}

// --- メモの画面の操作 ---
// 普通の文章のとき: 書くたびに自動で保存
sheetText.addEventListener('input', () => {
  activeSheet().text = sheetText.value;
  saveMemos();
});

// チェック付きのとき
sheetRows.addEventListener('input', e => {
  if (e.target.classList.contains('row-text')) {
    autoGrow(e.target);
    saveRows();
  }
});

sheetRows.addEventListener('change', e => {
  if (e.target.type === 'checkbox') {
    e.target.closest('.check-row').classList.toggle('done', e.target.checked);
    saveRows();
  }
});

sheetRows.addEventListener('keydown', e => {
  const input = e.target.closest('.row-text');
  if (!input || e.isComposing || e.keyCode === 229) return; // 日本語の変換中は、何もしない
  const row = input.closest('.check-row');
  if (e.key === 'Enter') {
    e.preventDefault();
    addRowAfter(row); // 改行キーで、下に新しい行
  } else if (e.key === 'Backspace' && input.value === '') {
    const prev = row.previousElementSibling;
    if (prev && prev.classList.contains('check-row')) {
      e.preventDefault(); // 空の行で削除キー → その行を消して、前の行へ
      row.remove();
      const prevInput = prev.querySelector('.row-text');
      prevInput.focus();
      prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
      saveRows();
    }
  }
});

sheetRows.addEventListener('click', e => {
  if (e.target.closest('.row-add')) addRowAfter(null);
});

sheetTabs.addEventListener('click', e => {
  const tab = e.target.closest('.sheet-tab');
  if (!tab || tab.dataset.id === memos.activeId) return;
  memos.activeId = tab.dataset.id;
  saveMemos();
  renderMemoView();
});

sheetChecklist.addEventListener('change', () => {
  activeSheet().checklist = sheetChecklist.checked;
  saveMemos();
  renderSheetBody(); // 内容は文章のまま。見せ方だけ切り替わる
});

sheetAdd.addEventListener('click', () => openNameDialog('add'));
sheetRename.addEventListener('click', () => openNameDialog('rename'));
sheetDelete.addEventListener('click', deleteSheet);
sheetCopy.addEventListener('click', copySheet);
sheetClearDone.addEventListener('click', clearDoneRows);

$('nameOk').addEventListener('click', submitName);
$('nameCancel').addEventListener('click', () => { nameMode = null; closeOverlay(); });
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    submitName();
  }
});

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

// ポップアップの外側(黒い部分)をタップしたら閉じる。予定メモは自動保存済みなので安心
[memoOverlay, exportOverlay, nameOverlay].forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeOverlay();
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeOverlay();
});

// 日付が変わったあとにアプリへ戻ったとき、「今日」の印を更新する
document.addEventListener('visibilitychange', () => {
  // (メモの画面は、書いている途中で作り直さない)
  if (document.visibilityState === 'visible' && !activeOverlay && view !== 'memo') renderCalendar();
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
