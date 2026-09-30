// Poster POS API bilan ishlash uchun soddalashtirilgan klient.
// Barcha metodlar https://{BASE_URL}/api/{modul}.{metod}?token={TOKEN}&... shaklida chaqiriladi.
require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.POSTER_BASE_URL || 'https://mondopos.joinposter.com';
const TOKEN = process.env.POSTER_TOKEN;

if (!TOKEN) {
  console.warn('[posterClient] OGOHLANTIRISH: POSTER_TOKEN .env faylida topilmadi');
}

const client = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 15000,
});

/**
 * Poster API metodini chaqirish.
 * @param {string} method masalan: 'menu.getProducts', 'dash.getCashShifts'
 * @param {object} params qo'shimcha query parametrlar (masalan sana oralig'i)
 * @param {string} httpMethod 'GET' (standart) yoki 'POST'
 */
async function call(method, params = {}, httpMethod = 'GET') {
  const config = { params: { token: TOKEN, ...params } };
  const res = httpMethod === 'POST'
    ? await client.post(`/${method}`, null, config)
    : await client.get(`/${method}`, config);
  // Poster xato bo'lsa ham 200 qaytarishi mumkin, shuning uchun tekshiramiz
  if (res.data && res.data.error) {
    const err = new Error(`Poster API xatosi [${method}]: ${JSON.stringify(res.data.error)}`);
    err.posterError = res.data.error;
    throw err;
  }
  return res.data && res.data.response !== undefined ? res.data.response : res.data;
}

module.exports = { call };
