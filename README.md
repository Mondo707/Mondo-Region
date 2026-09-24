# Mondo Region

Viloyat filiallari uchun boshqaruv tizimi (Poster POS integratsiyasi bilan).
Birinchi filial: **Farg'ona**.

## Texnologiya

- Backend: Node.js + Express + PostgreSQL (`pg`)
- Frontend: oddiy HTML/CSS/JS (build tizimi yo'q)
- Sessiya: `express-session` + `connect-pg-simple` (bazada saqlanadi)
- Excel eksport: `xlsx` (SheetJS)

## Mahalliy ishga tushirish

```bash
npm install
cp .env.example .env      # DATABASE_URL'ni o'z Postgres'ingizga moslang
npm start                 # http://localhost:3000
```

Birinchi ishga tushirishda avtomatik admin yaratiladi:
**login:** `admin`, **parol:** `admin123` — birinchi kirishdan keyin albatta almashtiring
(Admin panel → Foydalanuvchilar → Tahrirlash → yangi parol).

## Avtomatik testlar

```bash
npm test
```

Bu buyruq serverni o'zi ishga tushiradi (Poster mock rejimida), asosiy oqimlarni
(login, xodim/xarajat/bozorlik/kassa hisob-kitobi, rol chegaralari, ish kuni
mantig'i) tekshiradi va serverni to'xtatadi.

## Poster POS integratsiyasi haqida muhim eslatma

Bu muhitda (Claude orqali tayyorlashda) `joinposter.com` domenига tarmoq
ruxsati yo'q edi, shuning uchun barcha Poster chaqiruvlari **mock rejimda**
sinovdan o'tkazildi (`POSTER_MOCK=true`, `src/lib/poster.js` ichidagi mock
javoblar). Kod haqiqiy Poster API'siga to'g'ri mos yozilgan (tiyin/so'm
farqi, dublikat, epoch vaqt — barchasi hisobga olingan), lekin **haqiqiy
tokenlar bilan birinchi jonli sinov Render'ga joylashtirilgandan keyin**
bo'ladi. Productionda `.env`'da `POSTER_MOCK=false` qiling (yoki umuman olib
tashlang).

**Poster bilan solishtirish (`src/lib/posterCompare.js`) haqida qo'shimcha eslatma:**
quyidagi taxminlar hali haqiqiy Poster hisobida tekshirilmagan:
- Naqd to'lovlar `dash.getTransactions`da `payment_method_id === '0'` deb qabul qilinadi.
- Sertifikat mijozlari: `client_id '3'` = Yandex eats, `client_id '2'` = Jiz-Biz restaurant.
- Karta turlari `payment_types.poster_payment_method_id` orqali moslashtiriladi — buni
  admin panelda **To'lov turlari** bo'limida har bir turga Poster'dagi haqiqiy
  `payment_method_id`'ni kiritib qo'yish kerak (aks holda "Карточки (aniqlanmagan)"
  sifatida yig'iladi — bu tuzatiladigan, funksiyaga xalaqit bermaydigan holat).

Birinchi solishtirishdan keyin bu qiymatlar Poster'dagi haqiqiy ID'lar bilan
mos kelmasa, xabar bering — moslashtirib beraman.

## Render + Neon'ga joylashtirish

1. **GitHub**: `src/` va `public/` papkalarini **alohida-alohida** "Add file →
   Upload files" orqali yuklang (bittalab, hech qachon ikkalasini birga
   sudramang — GitHub ularni tekislab yuboradi).
2. **Neon**: yangi loyiha yarating (masalan nomi "Mondo Region"), ulanish
   satrini (`postgres://...`) nusxalab oling.
3. **Render**: yangi Web Service yarating, GitHub repo'ni bog'lang.
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment Variables: `.env.example`dagi hammasini kiriting
     (`DATABASE_URL` — Neon'dan, `POSTER_MOCK` — qo'ymang yoki `false`).
4. Birinchi deploy avtomatik ravishda bazani yaratadi (`initDb()`) va
   boshlang'ich admin foydalanuvchini qo'shadi.
5. `SYNC_INTERVAL_MINUTES`ni **10 dan kam qilmang** — aks holda Neon bazasi
   "uxlab" ulgurmaydi va bepul compute limiti tez tugaydi.

## Papka tuzilishi

```
src/
  server.js              — kirish nuqtasi
  config.js              — barcha sozlamalar (.env orqali)
  db.js                  — sxema + boshlang'ich ma'lumotlar
  lib/
    businessDay.js        — "ish kuni" (05:00–05:00) mantig'i
    poster.js              — Poster API wrapper (tiyin/so'm, dublikat, mock)
    cashCalc.js             — kassa formulasi
  middleware/auth.js       — rol/bo'lim asosidagi ruxsatlar
  routes/                  — barcha API endpointlar
  jobs/salesSync.js        — Poster'dan davriy savdo sinxronizatsiyasi
public/
  *.html                   — har bir bo'lim uchun sahifa
  js/api.js, nav.js, escpos.js
  css/style.css
  assets/logo.png
```

## Bo'limlar

| Bo'lim | Fayl | Ruxsat |
|---|---|---|
| Bosh sahifa | `dashboard.html` | hamma |
| Bozorlik | `bozorlik.html` | `bozorlik` |
| Kunlik savdo | `daily-sales.html` | `daily_sales` |
| Xarajatlar | `expenses.html` | `expenses` |
| Kassa kiritish | `cash-entry.html` | `cash` |
| Savdo | `savdo.html` | `savdo` |
| FOT | `fot.html` | `fot` (odatda admin) |
| Kirish tarixi | `login-history.html` | `login_history` |
| Admin panel | `admin.html` | admin / curator (tab'lar rolga qarab farqlanadi) |

Curator doimiy huquqlari: xodim yaratish/tahrirlash (Fiksa/Bonus'siz), kunlik
savdo kategoriyalari, bozorlik ingredientlari, bozorlikni Posterga kiritish.

## Bilingan cheklov

Bozorlikni bitta-bitta qayta hisoblash (`POST /api/cash/:date/recompute`)
ATAYLAB faqat bitta yozuv uchun ishlaydi — butun davr uchun ommaviy qayta
hisoblash funksiyasi Poster'ga ketma-ket ko'p so'rov yuborib, sekinlashtirish
va rate-limit xavfini keltirib chiqarishi mumkinligi sababli qo'shilmagan.

