// bonusConfig.json (promtdan olingan boshlang'ich qiymatlar) + admin panelda
// kiritilgan o'zgartirishlarni (bonus_config_overrides jadvali) birlashtiradi.
// Endi har bir pog'onaning min/max chegarasini ham (bonus summasidan tashqari)
// admin panelda o'zgartirish mumkin.

const { pool } = require('../db/db');
const baseConfig = require('../data/bonusConfig.json');

async function getEffectiveCategories() {
  const result = await pool.query('SELECT category, tier_index, bonus, min_override, max_override FROM bonus_config_overrides');
  const overrideMap = new Map();
  for (const o of result.rows) {
    overrideMap.set(`${o.category}::${o.tier_index}`, o);
  }

  const categories = {};
  for (const [category, cfg] of Object.entries(baseConfig.categories)) {
    categories[category] = {
      unit: cfg.unit,
      tiers: cfg.tiers.map((tier, idx) => {
        const override = overrideMap.get(`${category}::${idx}`);
        return {
          min: override && override.min_override !== null && override.min_override !== undefined ? override.min_override : tier.min,
          max: override && override.max_override !== null && override.max_override !== undefined ? override.max_override : tier.max,
          bonus: override ? override.bonus : tier.bonus,
        };
      }),
    };
  }
  return categories;
}

/**
 * Bitta pog'onaning bonus summasini va/yoki min/max chegarasini o'zgartiradi.
 * Har bir maydon ixtiyoriy - berilmasa, joriy (effektiv) qiymat saqlanadi.
 */
async function setTierConfig(category, tierIndex, { bonus, min, max } = {}) {
  if (!baseConfig.categories[category]) {
    throw new Error(`Noma'lum kategoriya: ${category}`);
  }
  const baseTiers = baseConfig.categories[category].tiers;
  if (tierIndex < 0 || tierIndex >= baseTiers.length) {
    throw new Error('Noto\'g\'ri pog\'ona raqami');
  }

  // Hozirgi effektiv qiymatlarni olamiz (faqat berilmagan maydonlarni to'ldirish uchun)
  const current = await pool.query(
    'SELECT bonus, min_override, max_override FROM bonus_config_overrides WHERE category = $1 AND tier_index = $2',
    [category, tierIndex]
  );
  const existing = current.rows[0];
  const baseTier = baseTiers[tierIndex];

  const finalBonus = bonus !== undefined ? bonus : (existing ? existing.bonus : baseTier.bonus);
  const finalMin = min !== undefined ? min : (existing && existing.min_override !== null ? existing.min_override : null);
  const finalMax = max !== undefined ? max : (existing && existing.max_override !== null ? existing.max_override : null);

  if (finalMin !== null && finalMax !== null && Number(finalMin) > Number(finalMax)) {
    throw new Error('Pastki chegara yuqori chegaradan katta bo\'lishi mumkin emas');
  }

  await pool.query(
    `INSERT INTO bonus_config_overrides (category, tier_index, bonus, min_override, max_override, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (category, tier_index) DO UPDATE SET
       bonus = EXCLUDED.bonus,
       min_override = EXCLUDED.min_override,
       max_override = EXCLUDED.max_override,
       updated_at = EXCLUDED.updated_at`,
    [category, tierIndex, finalBonus, finalMin, finalMax]
  );
}

// Eskisi bilan moslik uchun (agar boshqa joyda ishlatilgan bo'lsa)
async function setTierBonus(category, tierIndex, bonus) {
  return setTierConfig(category, tierIndex, { bonus });
}

/**
 * Berilgan kategoriyaning barcha pog'onalarini tekshirib, ketma-ketlikda
 * bo'shliq yoki qoplanish bo'lsa, ogohlantirish matnlarini qaytaradi.
 */
function validateTierContinuity(tiers) {
  const warnings = [];
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current.max === null || current.max === undefined) continue; // oxirgi pog'ona (cheksiz)
    if (next.min > current.max + 1) {
      warnings.push(`${current.min}-${current.max} bilan ${next.min}-${next.max || '∞'} orasida bo'shliq bor (${current.max + 1}-${next.min - 1} hech qaysi pog'onaga kirmaydi)`);
    } else if (next.min <= current.max) {
      warnings.push(`${current.min}-${current.max} va ${next.min}-${next.max || '∞'} pog'onalari bir-biriga qoplanadi`);
    }
  }
  return warnings;
}

module.exports = { getEffectiveCategories, setTierBonus, setTierConfig, validateTierContinuity };
