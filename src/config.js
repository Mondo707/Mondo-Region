require('dotenv').config();

function int(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

const config = {
  port: int('PORT', 3000),
  sessionSecret: process.env.SESSION_SECRET || 'mondo-region-dev-secret-change-me',
  databaseUrl: process.env.DATABASE_URL || 'postgres://mondo:mondo_dev_pass@localhost:5432/mondo_region',

  // "Ish kuni" — 05:00 dan boshlab, keyingi kun 05:00 gacha (Toshkent UTC+5).
  // KPI Mondo'dagi bilan bir xil mantiq — bu loyihada ham o'zgartirilmaydi.
  businessDayStartHour: int('BUSINESS_DAY_START_HOUR', 5),
  timezoneOffsetHours: int('TIMEZONE_OFFSET_HOURS', 5),

  // Fon jarayoni Poster'ga kamida shuncha daqiqada bir marta murojaat qiladi.
  // MUHIM: 10-15 daqiqadan kam qilib qo'yilsa, Neon bazasi hech qachon "uxlab"
  // ulgurmaydi va bepul compute limiti tez tugaydi (KPI Mondo'da bir marta xato
  // qilingan va tuzatilgan — Region loyihasida boshidanoq to'g'ri).
  syncIntervalMinutes: Math.max(10, int('SYNC_INTERVAL_MINUTES', 15)),

  // Kassa yozuvi yuborilgandan keyin, Poster bilan solishtirish natijasi
  // shuncha soat qulflangan turadi (admin istalgan vaqt ko'ra oladi).
  cashLockHours: int('CASH_LOCK_HOURS', 6),

  poster: {
    token: process.env.POSTER_TOKEN || '426040:96852720fb4bec9496838696bbae39d9',
    baseUrl: process.env.POSTER_BASE_URL || 'https://mondofargona.joinposter.com',
    // Bu muhitda joinposter.com domeniga tarmoq ruxsati yo'q, shuning uchun
    // mahalliy sinovlarda mock javoblar ishlatiladi. Productionda
    // POSTER_MOCK=false qilib qo'ying (yoki umuman o'rnatmang).
    mock: (process.env.POSTER_MOCK || 'true').toLowerCase() !== 'false',
    // Bozorlik ("Закупка") supply yaratishda ishlatiladigan doimiy
    // Поставщик va Склад ID'lari — Poster hisobida Network tab orqali
    // tasdiqlangan (supplier_id=1 "Закупка", storage_id=1 "Склад 1").
    supplierId: process.env.POSTER_SUPPLIER_ID || '1',
    storageId: process.env.POSTER_STORAGE_ID || '1',
  },

  branch: {
    slug: process.env.BRANCH_SLUG || 'fargona',
    name: process.env.BRANCH_NAME || "Farg'ona filiali",
  },
};

module.exports = config;
