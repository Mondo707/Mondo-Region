// Poster'dagi haqiqiy mahsulot ro'yxatini (menu.getProducts) bonusConfig.json
// ichidagi promt jadvali bilan NOM bo'yicha solishtiradi va product_id -> bonus_category
// xaritasini yaratadi. Server har ishga tushganda avtomatik chaqiradi
// (Render bepul tarifida qo'lda skript ishga tushirish imkoni yo'q).

const fs = require('fs');
const path = require('path');
const poster = require('./posterClient');
const bonusConfig = require('../data/bonusConfig.json');

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

async function matchProducts() {
  const posterProducts = await poster.call('menu.getProducts');

  const byName = new Map();
  for (const pp of posterProducts) {
    byName.set(normalize(pp.product_name), pp);
  }

  const matched = [];
  const unmatched = [];

  for (const cfgProduct of bonusConfig.products) {
    const key = normalize(cfgProduct.name);
    const pp = byName.get(key);
    if (pp) {
      matched.push({
        product_id: Number(pp.product_id),
        name: cfgProduct.name,
        bonus_category: cfgProduct.bonus_category,
        counts_for_bonus: cfgProduct.counts_for_bonus,
        kg_per_unit: cfgProduct.kg_per_unit,
      });
    } else {
      unmatched.push(cfgProduct.name);
    }
  }

  const outPath = path.join(__dirname, '..', 'data', 'productMap.json');
  fs.writeFileSync(outPath, JSON.stringify(matched, null, 2), 'utf-8');

  console.log(`[productMatcher] Mos kelgan: ${matched.length}/${bonusConfig.products.length}`);
  if (unmatched.length) {
    console.log('[productMatcher] Mos kelmagan nomlar:', unmatched.join(', '));
  }

  // bonusCalculator xotirasidagi xaritani ham yangilaymiz (server qayta ishga tushmasdan)
  try {
    require('./bonusCalculator').reloadProductMap();
  } catch (e) {
    // bonusCalculator hali yuklanmagan bo'lishi mumkin - muammo emas, keyinroq o'qiydi
  }

  return { matched: matched.length, total: bonusConfig.products.length, unmatched };
}

module.exports = { matchProducts };
