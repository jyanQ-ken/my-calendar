'use strict';

/* ===== holidays.js =====
   日本の祝日を「計算」で求めるファイルです。
   インターネットにはつながりません(通信ゼロ)。
   対応する年: 2000年〜2099年

   祝日は、次のようなルールで決まっています。
   ・日付が決まっているもの      例) 元日は1月1日
   ・「第○月曜日」で決まるもの   例) 海の日は7月の第3月曜日
   ・計算式で決まるもの          例) 春分の日・秋分の日
   ・特別ルール                  例) 日曜が祝日なら次の平日が「振替休日」
   これらをプログラムに書いてあるので、何年先でも自動で出ます。
   ※国が祝日のルールを変えたら、このファイルを直す必要があります。
*/

const HOLIDAY_MIN_YEAR = 2000;
const HOLIDAY_MAX_YEAR = 2099;

// カレンダーのマスは狭いので、短くした名前も用意します
const HOLIDAY_SHORT_NAMES = {
  '建国記念の日': '建国記念',
  '天皇誕生日': '天皇誕生',
  'みどりの日': 'みどり',
  '憲法記念日': '憲法記念',
  'こどもの日': 'こども',
  'スポーツの日': 'スポーツ',
  '勤労感謝の日': '勤労感謝',
  '国民の休日': '国民休日',
  '即位礼正殿の儀': '即位礼',
};

// 数字を2けたにそろえる (5 → "05")
function pad2(n) {
  return String(n).padStart(2, '0');
}

// 日付を "2026-11-03" という文字にする(script.jsでも使います)
function dateKey(year, month, day) {
  return year + '-' + pad2(month) + '-' + pad2(day);
}

// Dateから "2026-11-03" を作る
function keyOfDate(dt) {
  return dateKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// 「その月の第n月曜日」は何日か
function nthMonday(year, month, n) {
  const firstDow = new Date(year, month - 1, 1).getDay(); // 1日の曜日(0=日 … 6=土)
  const firstMonday = 1 + ((8 - firstDow) % 7);           // 最初の月曜日
  return firstMonday + 7 * (n - 1);
}

// 春分の日・秋分の日(1980〜2099年で使える計算式)
function springEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function autumnEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// 一度計算した年は覚えておく(同じ計算を何度もしないため)
const holidayCache = {};

// その年の祝日を全部求める → { "2026-01-01": "元日", ... }
function getHolidaysOfYear(year) {
  if (holidayCache[year]) return holidayCache[year];

  const list = {};
  const add = (month, day, name) => { list[dateKey(year, month, day)] = name; };

  // --- ふつうの祝日 ---
  add(1, 1, '元日');
  add(1, nthMonday(year, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  if (year >= 2020) add(2, 23, '天皇誕生日');
  if (year <= 2018) add(12, 23, '天皇誕生日'); // 2019年だけは天皇誕生日がない年
  add(3, springEquinoxDay(year), '春分の日');
  add(4, 29, year >= 2007 ? '昭和の日' : 'みどりの日');
  add(5, 3, '憲法記念日');
  if (year >= 2007) add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');

  // 海の日(2020・2021年は東京オリンピックのため特別な日付)
  if (year === 2020) add(7, 23, '海の日');
  else if (year === 2021) add(7, 22, '海の日');
  else if (year >= 2003) add(7, nthMonday(year, 7, 3), '海の日');
  else add(7, 20, '海の日');

  // 山の日(2016年から。2020・2021年は特別な日付)
  if (year >= 2016) {
    if (year === 2020) add(8, 10, '山の日');
    else if (year === 2021) add(8, 8, '山の日');
    else add(8, 11, '山の日');
  }

  // 敬老の日
  add(9, year >= 2003 ? nthMonday(year, 9, 3) : 15, '敬老の日');
  add(9, autumnEquinoxDay(year), '秋分の日');

  // 体育の日 → 2020年からスポーツの日(2020・2021年は特別な日付)
  if (year === 2020) add(7, 24, 'スポーツの日');
  else if (year === 2021) add(7, 23, 'スポーツの日');
  else add(10, nthMonday(year, 10, 2), year >= 2020 ? 'スポーツの日' : '体育の日');

  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  // 2019年だけの特別な休日(天皇の代替わり)
  if (year === 2019) {
    add(5, 1, '天皇の即位の日');
    add(10, 22, '即位礼正殿の儀');
  }

  // --- 国民の休日: 祝日と祝日にはさまれた平日(日曜は除く) ---
  const base = Object.assign({}, list); // この時点の祝日だけを見て判断する
  for (let m = 1; m <= 12; m++) {
    const lastDay = new Date(year, m, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const key = dateKey(year, m, d);
      if (list[key]) continue;                              // もう祝日
      if (new Date(year, m - 1, d).getDay() === 0) continue; // 日曜は対象外
      const prev = keyOfDate(new Date(year, m - 1, d - 1));
      const next = keyOfDate(new Date(year, m - 1, d + 1));
      if (base[prev] && base[next]) list[key] = '国民の休日';
    }
  }

  // --- 振替休日: 祝日が日曜なら、次の「休みでない日」が休みになる ---
  Object.keys(list).sort().forEach(key => {
    const parts = key.split('-').map(Number);
    if (new Date(parts[0], parts[1] - 1, parts[2]).getDay() !== 0) return; // 日曜だけ
    let t = new Date(parts[0], parts[1] - 1, parts[2] + 1);
    while (list[keyOfDate(t)]) {
      t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    }
    list[keyOfDate(t)] = '振替休日';
  });

  holidayCache[year] = list;
  return list;
}

// その日が祝日なら名前、そうでなければ "" を返す
function getHolidayName(year, month, day) {
  if (year < HOLIDAY_MIN_YEAR || year > HOLIDAY_MAX_YEAR) return '';
  return getHolidaysOfYear(year)[dateKey(year, month, day)] || '';
}

// カレンダーのマス用の短い名前
function getHolidayShortName(name) {
  return HOLIDAY_SHORT_NAMES[name] || name;
}
