// "Ish kuni" — oddiy kalendar kuni emas: BUSINESS_DAY_START_HOUR (odatda 05:00,
// Toshkent UTC+5) dan boshlab, keyingi kun xuddi shu vaqtgacha davom etadi.
// Bu fayl butun tizimda business_date ni izchil hisoblash uchun ishlatiladi.
const config = require('../config');

const TZ_OFFSET_MS = config.timezoneOffsetHours * 60 * 60 * 1000;
const START_HOUR_MS = config.businessDayStartHour * 60 * 60 * 1000;

/** UTC Date -> filial mahalliy vaqtidagi "devor soati" millisekundlari (epoch + offset). */
function toLocalWallMs(date) {
  return date.getTime() + TZ_OFFSET_MS;
}

/**
 * Berilgan vaqt (Date, default: hozir) qaysi "ish kuni"ga tegishli ekanini
 * aniqlaydi va shu kunning YYYY-MM-DD ko'rinishini qaytaradi.
 * Masalan, filial mahalliy vaqti bilan 04:59 da hali OLDINGI ish kuni davom
 * etyapti; 05:00 dan boshlab YANGI ish kuni boshlanadi.
 */
function businessDateFor(date = new Date()) {
  const localMs = toLocalWallMs(date);
  const shifted = localMs - START_HOUR_MS; // 05:00 ni "yarim tun" qilib suramiz
  const dayMs = Math.floor(shifted / 86400000) * 86400000;
  const d = new Date(dayMs); // bu — mahalliy kunning UTC-sifatida ifodalangan "sanasi"
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Berilgan business_date (YYYY-MM-DD) uchun [start, end) oralig'ini haqiqiy
 * UTC Date ob'ektlari sifatida qaytaradi — Poster so'rovlarida ishlatish uchun.
 */
function businessDateRange(businessDateStr) {
  const [y, m, d] = businessDateStr.split('-').map(Number);
  // Mahalliy 05:00 shu kunda boshlanadi -> UTC ga o'girish uchun offset ayiriladi.
  const startLocalMs = Date.UTC(y, m - 1, d) + START_HOUR_MS;
  const startUtcMs = startLocalMs - TZ_OFFSET_MS;
  const start = new Date(startUtcMs);
  const end = new Date(startUtcMs + 86400000);
  return { start, end };
}

module.exports = { businessDateFor, businessDateRange };
