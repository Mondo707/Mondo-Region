// Bonus hisoblash logikasi.
// Kirish: berilgan spot_id + sana uchun Poster tranzaksiyalari ro'yxati.
// Chiqish: har bir bonus kategoriyasi bo'yicha sotilgan miqdor va tegishli bonus summasi.

const fs = require('fs');
const path = require('path');
const { getEffectiveCategories } = require('./configService');
const { getDisabledCategories } = require('./spotCategoryConfig');
const { getOverridesMap } = require('./productCategoryOverride');

const PRODUCT_MAP_PATH = path.join(__dirname, '..', 'data', 'productMap.json');

let productById = new Map();

/**
 * productMap.json faylini (qayta) o'qib, xotiradagi xaritani yangilaydi.
 * Server ishga tushganda (yoki matchProducts() muvaffaqiyatli tugagandan keyin) chaqiriladi,
 * chunki fayl server ishga tushgan paytda hali mavjud bo'lmasligi mumkin.
 */
function reloadProductMap() {
  try {
    delete require.cache[require.resolve(PRODUCT_MAP_PATH)];
  } catch (e) {
    // hali cache qilinmagan bo'lishi mumkin, muammo emas
  }
  try {
    const productMap = JSON.parse(fs.readFileSync(PRODUCT_MAP_PATH, 'utf-8'));
    productById = new Map(productMap.map((p) => [p.product_id, p]));
    console.log(`[bonusCalculator] productMap yuklandi: ${productById.size} ta mahsulot`);
  } catch (e) {
    console.warn('[bonusCalculator] productMap.json hali mavjud emas yoki noto\'g\'ri.');
    productById = new Map();
  }
}

// Ilova ishga tushganda, agar fayl allaqachon mavjud bo'lsa, darhol yuklaymiz
reloadProductMap();

/**
 * Tranzaksiyalar ro'yxatidan bir kunlik/bitta filial uchun kategoriya bo'yicha
 * sotilgan miqdorlarni yig'adi.
 * @param {Array} transactions Poster transactions.getTransactions dan olingan .data massivi
 * @returns {Map<string, number>} kategoriya nomi -> jami miqdor (dona yoki kg)
 */
async function aggregateQuantities(transactions) {
  const totals = new Map();
  // Admin panelda qo'lda bog'langan mahsulotlar (yangi qo'shilgan, hali avtomatik
  // moslashtirilmagan) - bular productMap.json'dan USTUN turadi.
  const overrides = await getOverridesMap();

  for (const tx of transactions) {
    if (!tx.products) continue;
    for (const item of tx.products) {
      const num = Number(item.num) || 0;
      const overrideCategory = overrides.get(String(item.product_id));

      if (overrideCategory) {
        // Qo'lda bog'langan mahsulot - dona hisobida (kg_per_unit yo'q deb faraz qilinadi)
        const prev = totals.get(overrideCategory) || 0;
        totals.set(overrideCategory, prev + num);
        continue;
      }

      const info = productById.get(Number(item.product_id));
      if (!info || !info.counts_for_bonus) continue;

      const amount = info.kg_per_unit ? num * info.kg_per_unit : num;

      const prev = totals.get(info.bonus_category) || 0;
      totals.set(info.bonus_category, prev + amount);
    }
  }

  return totals;
}

/**
 * Berilgan miqdor uchun mos pog'onani topib, bonus summasini qaytaradi.
 * Agar miqdor birinchi pog'onadan kam bo'lsa (masalan 10 tadan kam), bonus 0.
 */
async function tierBonus(category, quantity) {
  const categories = await getEffectiveCategories();
  const cfg = categories[category];
  if (!cfg) return 0;

  let result = 0;
  for (const tier of cfg.tiers) {
    const inRange = tier.max === null ? quantity >= tier.min : quantity >= tier.min && quantity <= tier.max;
    if (inRange) {
      result = tier.bonus;
      break;
    }
  }
  return result;
}

/**
 * Bir kunlik/bitta filial uchun to'liq bonus hisobotini qaytaradi.
 * @param {Array} transactions shu kun + shu filial uchun tranzaksiyalar
 * @param {object} options { cashDiffOk: boolean, spotId: number } - cashDiffOk=false bo'lsa
 *   bonus butunlay 0 qilinadi; spotId berilsa, o'sha filial uchun o'chirilgan kategoriyalar
 *   hisobga olinmaydi (admin panelda sozlanadi).
 */
async function calculateDailyBonus(transactions, options = {}) {
  const quantities = await aggregateQuantities(transactions);
  const breakdown = [];
  let total = 0;

  const disabledCategories = options.spotId
    ? await getDisabledCategories(options.spotId)
    : new Set();

  for (const [category, qty] of quantities.entries()) {
    if (disabledCategories.has(category)) continue;
    const bonus = options.cashDiffOk === false ? 0 : await tierBonus(category, qty);
    breakdown.push({ category, quantity: Math.round(qty * 100) / 100, bonus });
    total += bonus;
  }

  return { breakdown, total, cashDiffOk: options.cashDiffOk !== false };
}

/**
 * Kunlik naqd/naqdsiz savdo yig'indisini tranzaksiyalardan hisoblaydi
 * (dash.getCashShifts o'rniga - u 405 xato berayotgani uchun).
 */
function sumCashCard(transactions) {
  let cash = 0;
  let card = 0;
  for (const tx of transactions) {
    cash += Number(tx.payed_cash) || 0;
    card += Number(tx.payed_card) || 0;
  }
  return { cash, card, total: cash + card };
}

/**
 * Poster tranzaksiyalaridan to'lov turlari bo'yicha yig'indini hisoblaydi.
 * DIQQAT: Poster tranzaksiya obyekti faqat payed_cash/payed_card/payed_cert/
 * payed_third_party maydonlarini beradi - UZCARD va HUMO kabi aniq karta turlarini
 * ajratib bermaydi. Shuning uchun "card" - barcha karta to'lovlari yig'indisi.
 */
function computePosterPaymentBreakdown(transactions) {
  let cash = 0, card = 0, cert = 0, thirdParty = 0, bonus = 0;
  for (const tx of transactions) {
    cash += Number(tx.payed_cash) || 0;
    card += Number(tx.payed_card) || 0;
    cert += Number(tx.payed_cert) || 0;
    thirdParty += Number(tx.payed_third_party) || 0;
    bonus += Number(tx.payed_bonus) || 0;
  }
  return { cash, card, cert, thirdParty, bonus };
}

/**
 * Berilgan Poster client_id'ga tegishli tranzaksiyalarning umumiy summasini hisoblaydi
 * (masalan "Yandex eats" yoki "Jiz-Biz restaurant" kanali uchun, admin panelda
 * sozlangan client_id xaritasi orqali).
 */
function sumByClientId(transactions, clientId) {
  if (!clientId) return 0;
  return transactions
    .filter((tx) => String(tx.client_id) === String(clientId))
    .reduce((sum, tx) => sum + (Number(tx.sum) || 0), 0);
}

/**
 * Xodim kiritgan summa bilan Poster hisobotidagi naqd summasini solishtiradi.
 * @param {number} enteredAmount xodim tomonidan ilovaga kiritilgan bugungi umumiy kassa
 * @param {number} posterCashTotal Poster'dagi 1 kunlik naqd+naqdsiz savdo yig'indisi
 * @param {number} limitPercent masalan 0.3
 */
function checkCashDiff(enteredAmount, posterCashTotal, limitPercent = 0.3) {
  if (posterCashTotal === 0) return { ok: true, diffPercent: 0 };
  const diff = Math.abs(enteredAmount - posterCashTotal);
  const diffPercent = (diff / posterCashTotal) * 100;
  return { ok: diffPercent <= limitPercent, diffPercent: Math.round(diffPercent * 100) / 100 };
}

/**
 * Avtomatik moslashtirilgan mahsulotlar xaritasini qaytaradi (faqat o'qish uchun) -
 * admin panelda "yangi/bog'lanmagan mahsulotlar"ni aniqlash uchun kerak.
 */
function getProductById() {
  return productById;
}

module.exports = {
  aggregateQuantities,
  tierBonus,
  calculateDailyBonus,
  sumCashCard,
  checkCashDiff,
  reloadProductMap,
  computePosterPaymentBreakdown,
  sumByClientId,
  getProductById,
};
