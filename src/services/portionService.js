// "Portsiya" bo'limi - xodim tarozida o'lchagan Смесь/Шарик (yoki admin
// qo'shgan boshqa ingredientlar) qoldig'ini Poster'dagi haqiqiy ombor
// qoldig'i bilan solishtiradi. Kassa kiritish bilan bir xil mantiq:
// bir necha soat qulflangan turadi, keyin Poster'dan bir marta olib keshlanadi.

const { pool } = require('../db/db');
const { getStorageLeftovers } = require('./posterStorage');

const RECONCILE_DELAY_HOURS = Number(process.env.PORTION_RECONCILE_DELAY_HOURS || 6);

function isLocked(entry) {
  const createdMs = new Date(entry.created_at).getTime();
  const unlockMs = createdMs + RECONCILE_DELAY_HOURS * 60 * 60 * 1000;
  return Date.now() < unlockMs;
}

function unlockTime(entry) {
  const createdMs = new Date(entry.created_at).getTime();
  return new Date(createdMs + RECONCILE_DELAY_HOURS * 60 * 60 * 1000).toISOString();
}

async function getTrackedIngredients() {
  const result = await pool.query('SELECT id, display_name, poster_ingredient_id, poster_ingredient_name FROM portion_ingredients ORDER BY id');
  return result.rows;
}

/**
 * Xodim kiritgan (Fakt) va Poster'dagi haqiqiy qoldiqni solishtiradi.
 * Natija har bir ingredient uchun: fakt, poster, farq (poster - fakt emas,
 * FAKT - POSTER, ya'ni musbat = xodimda ko'p chiqdi, manfiy = kam chiqdi).
 */
async function getComparison(entry, options = {}) {
  if (!options.forceUnlock && isLocked(entry)) {
    return { locked: true, unlock_at: unlockTime(entry) };
  }

  const ingredients = await getTrackedIngredients();
  const enteredValues = JSON.parse(entry.values_json || '{}');

  let posterValues;
  if (entry.poster_snapshot) {
    posterValues = JSON.parse(entry.poster_snapshot);
  } else {
    const leftoverMap = await getStorageLeftovers(entry.spot_id);
    posterValues = {};
    ingredients.forEach((ing) => {
      posterValues[ing.id] = leftoverMap.get(String(ing.poster_ingredient_id)) ?? null;
    });

    await pool.query(
      'UPDATE portion_entries SET poster_snapshot = $1, poster_synced_at = now() WHERE id = $2',
      [JSON.stringify(posterValues), entry.id]
    );
  }

  const rows = ingredients.map((ing) => {
    const fakt = Number(enteredValues[ing.id]) || 0;
    const posterVal = posterValues[ing.id];
    const poster = posterVal === null || posterVal === undefined ? null : Number(posterVal);
    const diff = poster === null ? null : Math.round((fakt - poster) * 100) / 100;
    return {
      ingredient_id: ing.id,
      name: ing.display_name,
      fakt,
      poster,
      diff,
      status: diff === null ? 'unknown' : diff === 0 ? 'ok' : diff > 0 ? 'ko\'p' : 'kam',
    };
  });

  return { locked: false, rows, computed_at: entry.poster_synced_at || new Date().toISOString() };
}

/**
 * Filiallar bo'yicha farq hisoboti: berilgan davr uchun har bir filial va
 * har bir ingredient bo'yicha UMUMIY farq va O'RTACHA KUNLIK farqni hisoblaydi.
 * Faqat allaqachon hisoblangan (poster_snapshot mavjud) yozuvlardan foydalanadi -
 * Poster'ga qo'shimcha so'rov yubormaydi (tezkor, ko'p filial/kun bo'lsa ham og'irlik qilmaydi).
 */
async function getBranchReport(spotIds, dateFrom, dateTo) {
  const ingredients = await getTrackedIngredients();

  const result = await pool.query(
    `SELECT date, spot_id, values_json, poster_snapshot FROM portion_entries
     WHERE spot_id = ANY($1) AND date >= $2 AND date <= $3 AND poster_snapshot IS NOT NULL`,
    [spotIds, dateFrom, dateTo]
  );

  // spot_id -> ingredient_id -> { total, count }
  const agg = new Map();
  spotIds.forEach((sId) => {
    const perIngredient = new Map();
    ingredients.forEach((ing) => perIngredient.set(ing.id, { total: 0, count: 0 }));
    agg.set(sId, perIngredient);
  });

  for (const row of result.rows) {
    const enteredValues = JSON.parse(row.values_json || '{}');
    const posterValues = JSON.parse(row.poster_snapshot || '{}');
    const perIngredient = agg.get(row.spot_id);
    if (!perIngredient) continue;

    ingredients.forEach((ing) => {
      const posterVal = posterValues[ing.id];
      if (posterVal === null || posterVal === undefined) return;
      const fakt = Number(enteredValues[ing.id]) || 0;
      const diff = fakt - Number(posterVal);
      const entry = perIngredient.get(ing.id);
      entry.total += diff;
      entry.count += 1;
    });
  }

  const rows = spotIds.map((spotId) => {
    const perIngredient = agg.get(spotId);
    const ingredientResults = {};
    ingredients.forEach((ing) => {
      const entry = perIngredient.get(ing.id);
      ingredientResults[ing.id] = {
        name: ing.display_name,
        total_diff: Math.round(entry.total * 100) / 100,
        avg_diff: entry.count ? Math.round((entry.total / entry.count) * 100) / 100 : 0,
        days_count: entry.count,
      };
    });
    return { spot_id: spotId, ingredients: ingredientResults };
  });

  return { ingredients: ingredients.map((i) => ({ id: i.id, name: i.display_name })), rows };
}

module.exports = { getTrackedIngredients, getComparison, isLocked, unlockTime, getBranchReport, RECONCILE_DELAY_HOURS };
