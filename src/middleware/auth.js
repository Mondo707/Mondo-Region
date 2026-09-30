function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Tizimga kiring' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Tizimga kiring' });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Bu amal uchun huquqingiz yetarli emas' });
    }
    next();
  };
}

/** Admin har doim o'tadi; boshqalar allowed_sections ichida shu bo'lim bo'lsa o'tadi. */
function requireSection(section) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Tizimga kiring' });
    const u = req.session.user;
    if (u.role === 'admin') return next();
    if (Array.isArray(u.allowed_sections) && u.allowed_sections.includes(section)) return next();
    return res.status(403).json({ error: `"${section}" bo'limiga ruxsatingiz yo'q` });
  };
}

// Curator uchun kelishilgan doimiy huquqlar ro'yxati (Region loyihasi spetsifikatsiyasi):
// xodim yaratish/tahrirlash (Fiksa/bonus'siz), kunlik savdo kategoriyalari,
// bozorlik ingredientlari, bozorlikni Posterga kiritish.
const CURATOR_PERMISSIONS = new Set([
  'employees:write', // Fiksa/bonus maydonlari route darajasida alohida bloklanadi
  'sales_categories:write',
  'ingredients:write',
  'bozorlik:approve_post',
]);

/** admin yoki curator (curator uchun doimiy CURATOR_PERMISSIONS ro'yxati tekshiriladi) */
function requireAdminOrCurator(permission) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Tizimga kiring' });
    const u = req.session.user;
    if (u.role === 'admin') return next();
    if (u.role === 'curator' && CURATOR_PERMISSIONS.has(permission)) return next();
    return res.status(403).json({ error: 'Bu amal uchun huquqingiz yetarli emas' });
  };
}

module.exports = { requireAuth, requireRole, requireSection, requireAdminOrCurator, CURATOR_PERMISSIONS };
