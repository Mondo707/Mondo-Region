// Poster POS API bilan ishlash — KPI Mondo loyihasida uzoq sinov-xato orqali
// topilgan qoidalarga qat'iy amal qiladi. BULARNI QAYTA KASHF QILMANG:
//
// 1) dash.getTransactions summalari TIYIN'da keladi (100 ga bo'linadi!).
//    transactions.getTransactions esa SO'M'da (`.00` bilan) keladi.
// 2) "Ish kuni" kechayarim orqali o'tgani sababli, ikkita kalendar kunini
//    so'raganda bitta yozuv ikkalasida ham qaytishi mumkin — har doim
//    transaction_id / cash_shift_id bo'yicha dublikatlar olib tashlanadi.
// 3) Turli metodlar orasida ~2 soatlik vaqt zonasi nomuvofiqligi bor — vaqtni
//    solishtirish uchun RAQAMLI epoch millisekund (masalan tx.date_close)
//    ishlatiladi, matn ko'rinishi (date_close_date) emas.
// 4) ISHLAMAYDIGAN (405): dash.getReceipts, transactions.getTransaction
//    (birlik), dash.getCashShifts (POST bilan).
// 5) finance.getCashShifts: date_end === "0000-00-00 00:00:00" yoki
//    timeend === 0 bo'lsa — smena hali OCHIQ.
//
// Bu muhitda joinposter.com ga tarmoq ruxsati yo'q, shuning uchun
// config.poster.mock=true bo'lsa mock javoblar qaytariladi (mahalliy
// sinovlar shu holatda o'tadi). Productionda POSTER_MOCK=false qiling.

const fetch = require('node-fetch');
const cfg = require('../config');

function dedupeById(items, idField) {
  const map = new Map();
  for (const item of items) {
    map.set(item[idField], item); // keyingi nusxa oldingisini almashtiradi — natija bir xil
  }
  return Array.from(map.values());
}

async function posterCall(method, params = {}, httpMethod = 'GET') {
  const url = new URL(`${cfg.poster.baseUrl}/api/${method}`);
  url.searchParams.set('token', cfg.poster.token);

  let res;
  if (httpMethod === 'POST') {
    // Yozish/yaratish amallari (masalan storage.createSupply) — Poster bunday
    // metodlarni GET bilan qabul qilmaydi (HTTP 405 qaytaradi), token GET
    // so'rovlaridagidek query'da qoladi, ma'lumot esa JSON body'da yuboriladi.
    res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } else {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    res = await fetch(url.toString(), { method: 'GET' });
  }

  if (!res.ok) {
    throw new Error(`Poster API xatosi: ${method} -> HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`Poster API xatosi: ${method} -> ${JSON.stringify(json.error)}`);
  }
  return json.response;
}

// ---- Mock ma'lumotlar (faqat mahalliy sinov uchun) -------------------------
const mock = {
  async dashGetTransactions({ dateFrom, dateTo }) {
    // Summalar TIYIN'da (100 = 1 so'm). payment_method_id: '0'=naqd (mock shartlashuv),
    // '1'/'2'=kartalar, client_id '2'/'3' bo'lsa — sertifikat (Jiz-Biz/Yandex eats).
    return [
      { transaction_id: '9001', date_close: Date.now() - 3600000, payment_method_id: '0', sum: 208800000, client_id: '0' },
      { transaction_id: '9002', date_close: Date.now() - 7200000, payment_method_id: '1', sum: 42400000, client_id: '0' },
      { transaction_id: '9003', date_close: Date.now() - 5400000, payment_method_id: '2', sum: 21900000, client_id: '0' },
    ];
  },
  async financeGetCashShifts() {
    return [
      { cash_shift_id: '501', date_start: '2026-09-23 09:02:00', date_end: '2026-09-24 04:50:00', amount_start: 200000, amount_end: 94000 },
    ];
  },
  async clientsGetClients() {
    return [
      { client_id: '2', client_name: 'Jiz-Biz restaurant' },
      { client_id: '3', client_name: 'Yandex eats' },
    ];
  },
  async transactionsGetTransactions({ dateFrom, dateTo }) {
    // Summalar SO'M'da
    return [
      { transaction_id: '9001', date_close: Date.now() - 3600000, date_close_date: '2026-09-23 14:00:00', products: [{ product_id: '101', num: 3, product_sum: '45000.00' }] },
      { transaction_id: '9002', date_close: Date.now() - 7200000, date_close_date: '2026-09-23 13:00:00', products: [{ product_id: '205', num: 2, product_sum: '38000.00' }] },
    ];
  },
  async menuGetProducts() {
    return [
      { product_id: '101', product_name: 'Лимонад Klassik', category_id: '11' },
      { product_id: '205', product_name: 'Milkshake Banan', category_id: '14' },
    ];
  },
  async spotsGetSpots() {
    return [{ spot_id: '1', name: "Farg'ona" }];
  },
  async storageGetIngredients() {
    // "Поставщик = Закупка" ostida kiritilgan tovarlarga o'xshash mock ro'yxat.
    return [
      { ingredient_id: '301', ingredient_name: 'Pomidor', ingredient_unit: 'kg' },
      { ingredient_id: '302', ingredient_name: 'Bodring', ingredient_unit: 'kg' },
      { ingredient_id: '303', ingredient_name: "Ko'katlar", ingredient_unit: 'dasta' },
    ];
  },
  async createSupply(payload) {
    // Rasmiy hujjatga ko'ra haqiqiy Poster javobi to'g'ridan-to'g'ri raqam
    // (masalan 7) — obyekt emas. Sinov uchun shunga mos son qaytaramiz.
    return Date.now() % 100000;
  },
};

// Ish kuni sanasiga joriy vaqtni qo'shib, Poster kutgan "Y-m-d H:i:s" formatiga o'giradi.
function formatPosterSupplyDate(businessDate) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${businessDate} ${hh}:${mm}:${ss}`;
}

const poster = {
  /** dash.getTransactions — to'lov turi tafsiloti, mijoz ID. Summalar TIYIN'da. */
  async dashGetTransactions(opts) {
    const raw = cfg.poster.mock
      ? await mock.dashGetTransactions(opts)
      : await posterCall('dash.getTransactions', opts);
    const deduped = dedupeById(raw, 'transaction_id');
    return deduped.map((t) => ({ ...t, sum_som: Number(t.sum) / 100 }));
  },

  /** finance.getCashShifts — kassa smenasi. timeend===0 / date_end==="0000-00-00 00:00:00" => ochiq. */
  async financeGetCashShifts(opts) {
    const raw = cfg.poster.mock
      ? await mock.financeGetCashShifts(opts)
      : await posterCall('finance.getCashShifts', opts);
    const deduped = dedupeById(raw, 'cash_shift_id');
    return deduped.map((s) => ({
      ...s,
      is_open: !s.date_end || s.date_end === '0000-00-00 00:00:00' || Number(s.timeend) === 0,
    }));
  },

  /** clients.getClients — Yandex eats = 3, Jiz-Biz = 2 (shu Poster akkauntida). */
  async clientsGetClients() {
    return cfg.poster.mock ? mock.clientsGetClients() : posterCall('clients.getClients');
  },

  /** transactions.getTransactions — oddiy tranzaksiya ro'yxati, SO'M'da, bonus/savdo hisobi uchun. */
  async transactionsGetTransactions(opts) {
    const raw = cfg.poster.mock
      ? await mock.transactionsGetTransactions(opts)
      : await posterCall('transactions.getTransactions', opts);
    return dedupeById(raw, 'transaction_id');
  },

  /** menu.getProducts — mahsulotlar ro'yxati, bonus/savdo kategoriyasiga moslashtirish uchun. */
  async menuGetProducts() {
    return cfg.poster.mock ? mock.menuGetProducts() : posterCall('menu.getProducts');
  },

  /** spots.getSpots — filiallar ro'yxati. */
  async spotsGetSpots() {
    return cfg.poster.mock ? mock.spotsGetSpots() : posterCall('spots.getSpots');
  },

  /**
   * menu.getIngredients — Poster'dagi barcha ombor ingredientlari ro'yxati.
   * TUZATILDI: avval noto'g'ri `storage.getIngredients` ishlatilgan edi va bu
   * haqiqiy Poster hisobida HTTP 405 (Method Not Allowed) xato qaytargan —
   * chunki bunday metod umuman yo'q. Rasmiy hujjatga ko'ra to'g'ri metod
   * `menu.getIngredients` (dev.joinposter.com/docs/v3/web/menu/getIngredients).
   * Javob maydonlari (`ingredient_id`, `ingredient_name`, `ingredient_unit`)
   * `menu.getProducts`ga o'xshash deb taxmin qilingan — agar Poster boshqa
   * maydon nomlari bilan qaytarsa (masalan `unit` o'rniga boshqa nom), shu
   * funksiya ichida moslashtirish kerak bo'ladi.
   */
  async menuGetIngredients() {
    const raw = cfg.poster.mock ? await mock.storageGetIngredients() : await posterCall('menu.getIngredients');
    return dedupeById(raw, 'ingredient_id');
  },

  /**
   * Bozorlikni Poster'ga "Закупка" (Postavshik=Bozor, storage_id/supplier_id=1)
   * formatida supply sifatida yuboradi.
   *
   * TUZATILDI (3 marta, oxirgisi rasmiy hujjat asosida — dev.joinposter.com):
   * 1) Avval GET so'rov yuborilar edi (HTTP 405) — endi POST.
   * 2) Payload tuzilishi {supply:{...}, ingredient:[...]} ga moslashtirildi.
   * 3) RASMIY HUJJATGA KO'RA ANIQLANDI:
   *    - ingredient[].type: tovar/tex.karta=1, INGREDIENT=4 (biz avval
   *      hammasi uchun "1" yuborayotgan edik — bu xato edi, chunki Bozorlik
   *      har doim ingredient kiritadi).
   *    - ingredient[].sum: bu BIRLIK NARXI (chegirmasiz), qatorning jami
   *      summasi EMAS (biz avval jami summani yuborayotgan edik).
   *    - javob (`response`) to'g'ridan-to'g'ri yangi supply'ning ID raqami
   *      (masalan `7`), obyekt emas.
   *    - `packing` — ixtiyoriy, faqat haqiqiy fasovka ID'si bo'lsa
   *      yuboriladi; biz buni umuman yubormaymiz (default fasovka ishlatiladi).
   *
   * items: [{ posterIngredientId, quantity, unitPrice }]
   */
  async createSupply({ businessDate, comment, items }) {
    const supply = {
      date: formatPosterSupplyDate(businessDate),
      supplier_id: cfg.poster.supplierId,
      storage_id: cfg.poster.storageId,
    };
    if (comment) supply.supply_comment = comment;

    const body = {
      supply,
      ingredient: items.map((it) => ({
        id: String(it.posterIngredientId),
        type: '4', // 4 = ingredient (rasmiy hujjatga ko'ra)
        num: String(it.quantity),
        sum: String(it.unitPrice), // birlik narxi, jami summa emas
      })),
    };
    return cfg.poster.mock ? mock.createSupply(body) : posterCall('storage.createSupply', body, 'POST');
  },
};

module.exports = poster;
