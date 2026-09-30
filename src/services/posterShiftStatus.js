// Kassa smenasi (zakrit smen) shu kun uchun yopilganmi-yo'qmi, deb tekshiradi.
//
// Diagnostika orqali tasdiqlandi: "finance.getCashShifts" (GET) ishlaydi va
// har bir smena uchun quyidagi maydonlarni beradi:
//   date_end: "0000-00-00 00:00:00" -> smena HALI OCHIQ (yopilmagan)
//   date_end: haqiqiy sana/vaqt      -> smena YOPILGAN
// Agar bu metod ham ishlamay qolsa, tizim "aniqlab bo'lmadi" holatini qaytaradi
// va Yuborish tugmasini BLOKLAMAYDI (xatoga yo'l qo'ymaslik uchun ehtiyotkorlik bilan).

const poster = require('./posterClient');

const ZERO_DATE = '0000-00-00 00:00:00';

const CANDIDATES = [
  { method: 'finance.getCashShifts', httpMethod: 'GET' },
  { method: 'dash.getCashShifts', httpMethod: 'GET' },
];

/**
 * @returns {{status: 'closed'|'open'|'unknown', raw?: any}}
 */
async function getShiftStatus(spotId, dateStr) {
  for (const { method, httpMethod } of CANDIDATES) {
    try {
      const data = await poster.call(method, { date_from: dateStr, date_to: dateStr, spot_id: spotId }, httpMethod);
      const list = Array.isArray(data) ? data : (data && data.response) || [];
      if (Array.isArray(list) && list.length > 0) {
        // Shu filialga tegishli smenalarni olib, oxirgisini tekshiramiz
        const spotShifts = list.filter((s) => !s.spot_id || Number(s.spot_id) === Number(spotId));
        const shift = (spotShifts.length ? spotShifts : list)[spotShifts.length ? spotShifts.length - 1 : list.length - 1];
        const dateEnd = shift.date_end || '';
        const isClosed = dateEnd && dateEnd !== ZERO_DATE;
        return { status: isClosed ? 'closed' : 'open', raw: shift };
      }
    } catch (e) {
      // keyingi nomzodni sinaymiz
    }
  }
  return { status: 'unknown' };
}

module.exports = { getShiftStatus };
