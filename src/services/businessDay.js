// "Ish kuni" (business day) tushunchasi: 05:00 dan boshlab, keyingi kun 05:00 gacha.
// Masalan 23-sana tanlansa: 23-avgust 05:00 dan 24-avgust 05:00 gacha bo'lgan barcha
// tranzaksiyalar "23-avgust"ning savdosi hisoblanadi (garchi ba'zilari kalendar
// bo'yicha 24-avgustga to'g'ri kelsa ham - masalan tunda soat 02:00 dagi sotuv).
//
// Buni o'zgartirish uchun quyidagi BUSINESS_DAY_START_HOUR qiymatini o'zgartiring
// (yoki .env faylida BUSINESS_DAY_START_HOUR=5 qatorini qo'shing/o'zgartiring).

const DEFAULT_START_HOUR = Number(process.env.BUSINESS_DAY_START_HOUR || 5);

// Server (Render) odatda UTC vaqtida ishlaydi, lekin Poster'dagi barcha vaqt
// belgilari O'zbekiston vaqtida (UTC+5, yil bo'yi o'zgarmaydi - DST yo'q).
// Shuning uchun "hozir soat nechida (Toshkent bo'yicha)" ni aniqlashda shu offsetni ishlatamiz.
const TIMEZONE_OFFSET_HOURS = Number(process.env.TIMEZONE_OFFSET_HOURS || 5);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * Berilgan "ish kuni" (masalan '2026-08-23') uchun vaqt oynasini hisoblaydi.
 * @param {string} dateStr 'YYYY-MM-DD' formatida
 * @param {number} startHour soat nechida ish kuni boshlanadi (standart: 5)
 * @returns {{startStr: string, endStr: string, fetchDates: string[]}}
 *   startStr/endStr - "YYYY-MM-DD HH:MM:SS" formatida solishtirish uchun (Poster'ning
 *   date_close maydoni bilan bir xil format, shuning uchun matn sifatida solishtirsa bo'ladi)
 *   fetchDates - Poster'dan qaysi kalendar kunlarini so'rash kerakligi (odatda 2 ta kun)
 */
function getBusinessDayWindow(dateStr, startHour = DEFAULT_START_HOUR) {
  const nextDate = addDays(dateStr, 1);
  const h = pad2(startHour);
  return {
    startStr: `${dateStr} ${h}:00:00`,
    endStr: `${nextDate} ${h}:00:00`,
    fetchDates: [dateStr, nextDate],
  };
}

/**
 * Tranzaksiyalar ro'yxatini berilgan ish kuni oynasiga qarab filtrlaydi.
 * @param {Array} transactions date_close maydoniga ega tranzaksiyalar
 * @param {string} dateStr 'YYYY-MM-DD'
 */
function filterByBusinessDay(transactions, dateStr, startHour = DEFAULT_START_HOUR) {
  const { startStr, endStr } = getBusinessDayWindow(dateStr, startHour);
  return transactions.filter((tx) => tx.date_close >= startStr && tx.date_close < endStr);
}

/**
 * Hozirgi vaqtga mos "ish kuni"ni (business date) aniqlaydi - server qaysi vaqt
 * zonasida ishlashidan qat'iy nazar, Toshkent vaqti bo'yicha hisoblanadi.
 * Masalan hozir Toshkentda soat 02:00 bo'lsa (ya'ni 05:00 dan oldin), bu hali
 * "kechagi" ish kuniga tegishli hisoblanadi.
 */
function getCurrentBusinessDate(startHour = DEFAULT_START_HOUR) {
  const nowUtcMs = Date.now();
  const tashkentMs = nowUtcMs + TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;
  const tashkentNow = new Date(tashkentMs);

  let year = tashkentNow.getUTCFullYear();
  let month = tashkentNow.getUTCMonth();
  let day = tashkentNow.getUTCDate();

  if (tashkentNow.getUTCHours() < startHour) {
    const prev = new Date(Date.UTC(year, month, day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    year = prev.getUTCFullYear();
    month = prev.getUTCMonth();
    day = prev.getUTCDate();
  }

  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/**
 * Xuddi getBusinessDayWindow, lekin natijani UTC epoch millisekundlarida qaytaradi
 * (matn taqqoslash o'rniga). Bu ba'zi Poster metodlari (masalan dash.getTransactions)
 * date_close'ni raqamli epoch ko'rinishida berganda, vaqt zonasi noaniqliklaridan
 * qochish uchun ishlatiladi - eng ishonchli usul.
 */
function getBusinessDayWindowEpoch(dateStr, startHour = DEFAULT_START_HOUR) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Toshkentda "dateStr startHour:00:00" = UTC'da shu vaqtdan TIMEZONE_OFFSET_HOURS kam
  const startMs = Date.UTC(y, m - 1, d, startHour, 0, 0) - TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

module.exports = { getBusinessDayWindow, getBusinessDayWindowEpoch, filterByBusinessDay, getCurrentBusinessDate, DEFAULT_START_HOUR };
