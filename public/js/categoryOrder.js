// Barcha sahifalarda (chek, kunlik savdo va h.k.) kategoriyalar shu tartibda ko'rsatiladi.
const CATEGORY_ORDER = [
  'Шарик', 'Смесь', 'Кофе 250 мл', 'Кофе 350 мл', 'Чашка кофе', 'Айс кофе',
  'Лимонады', 'Манго сок', 'Милкшейк', 'Вафли', 'Десерты', 'Сан-себастьян',
  'Фреш', 'Фрозен', 'Чай', 'Фасовка',
];

// Berilgan kategoriya nomlari ro'yxatini CATEGORY_ORDER tartibida saralaydi.
// Ro'yxatda bo'lmagan kategoriyalar oxiriga qo'shiladi (yo'qolib qolmasligi uchun).
function sortByCategoryOrder(categoryNames) {
  const known = CATEGORY_ORDER.filter((c) => categoryNames.includes(c));
  const unknown = categoryNames.filter((c) => !CATEGORY_ORDER.includes(c));
  return [...known, ...unknown];
}
