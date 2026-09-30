// USB termal printerga (masalan Xprinter XP-80C) brauzerdan TO'G'RIDAN-TO'G'RI,
// Windows chop etish navbatini (print spooler) chetlab o'tib yozish uchun.
//
// NEGA KERAK: ba'zi POS dasturlari (masalan Poster) o'rnatilganda printerning
// USB drayverini "WinUSB"ga almashtirib qo'yadi - bu Windows'ning oddiy printer
// navbatini (va demak brauzerning window.print() funksiyasini) butunlay
// ishlamay qoladigan qiladi, garchi printerning o'zi ishlab tursa ham.
// WebUSB texnologiyasi esa aynan shu WinUSB drayveriga ega qurilmalarga
// to'g'ridan-to'g'ri, xavfsiz tarzda murojaat qila oladi.
//
// TALABLAR: faqat Chrome yoki Edge brauzerida ishlaydi, sayt HTTPS orqali
// ochilgan bo'lishi kerak (localhost'da ham ishlaydi).

const ESC = 0x1B;
const GS = 0x1D;

// ---- CP866 (DOS Cyrillic) kodlashtirish jadvali ----
// Ko'pchilik ESC/POS termal printerlar kirill harflarini shu kodlashda qabul qiladi.
// Agar sizning printeringizda kirill harflari noto'g'ri (chalkash belgilar) chiqsa,
// pastdagi CODEPAGE_COMMAND qiymatini o'zgartirish kerak bo'lishi mumkin (fayl oxirida izoh bor).
function buildCp866Map() {
  const map = {};
  const upper = 'АБВГДЕЖЗИЙКЛМНОП'; // U+0410-U+041F -> 0x80-0x8F
  const upper2 = 'РСТУФХЦЧШЩЪЫЬЭЮЯ'; // U+0420-U+042F -> 0x90-0x9F
  const lower = 'абвгдежзийклмноп'; // U+0430-U+043F -> 0xA0-0xAF
  const lower2 = 'рстуфхцчшщъыьэюя'; // U+0440-U+044F -> 0xE0-0xEF

  [...upper].forEach((ch, i) => { map[ch] = 0x80 + i; });
  [...upper2].forEach((ch, i) => { map[ch] = 0x90 + i; });
  [...lower].forEach((ch, i) => { map[ch] = 0xA0 + i; });
  [...lower2].forEach((ch, i) => { map[ch] = 0xE0 + i; });
  map['Ё'] = 0xF0;
  map['ё'] = 0xF1;
  return map;
}
const CP866_MAP = buildCp866Map();

// Printerda CP866 kodlash jadvalini tanlash buyrug'i (Epson-mos ESC/POS uchun odatiy).
// Agar kirill harflari noto'g'ri chiqsa, shu raqamni 17, 18, 40, 45 kabi qiymatlarga
// almashtirib ko'ring (printer modeliga qarab farq qiladi).
const CODEPAGE_COMMAND = 17;

function encodeText(str) {
  const bytes = [];
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code === 0xA0 || code === 0x202F) {
      // toLocaleString('ru-RU') minglik ajratgichi sifatida "uzilmaydigan bo'shliq"
      // (U+00A0 yoki U+202F) ishlatadi - printer buni tanimaydi, oddiy bo'shliqqa almashtiramiz
      bytes.push(0x20);
    } else if (code < 0x80) {
      bytes.push(code);
    } else if (CP866_MAP[ch] !== undefined) {
      bytes.push(CP866_MAP[ch]);
    } else {
      bytes.push(0x3F); // '?' - noma'lum belgi
    }
  }
  return bytes;
}

class EscPosBuilder {
  constructor() {
    this.bytes = [];
    this.bytes.push(ESC, 0x40); // Initialize
    this.bytes.push(ESC, 0x74, CODEPAGE_COMMAND); // Select CP866 codepage
  }
  raw(...b) { this.bytes.push(...b); return this; }
  text(str) { this.bytes.push(...encodeText(str)); return this; }
  line(str = '') { this.text(str); this.bytes.push(0x0A); return this; }
  center() { return this.raw(ESC, 0x61, 0x01); }
  left() { return this.raw(ESC, 0x61, 0x00); }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  doubleSize(on) { return this.raw(GS, 0x21, on ? 0x11 : 0x00); }
  hr(width = 42, ch = '-') { return this.line(ch.repeat(width)); }
  // Ikki ustunli qator: chapga nom, o'ngga summa (fixed-width monospace shrift asosida)
  row(label, value, width = 42) {
    const l = String(label);
    const v = String(value);
    const spaces = Math.max(1, width - l.length - v.length);
    return this.line(l + ' '.repeat(spaces) + v);
  }
  feed(n = 3) { for (let i = 0; i < n; i++) this.bytes.push(0x0A); return this; }
  cut() { return this.raw(GS, 0x56, 0x00); } // To'liq kesish (agar printer qo'llasa)
  build() { return new Uint8Array(this.bytes); }
}

let cachedDevice = null;
let cachedEndpoint = null;
let cachedInterface = null;

function isWebUSBSupported() {
  return !!(navigator.usb);
}

/**
 * Qurilmadan mos "bulk OUT" endpoint'ni va interfeys raqamini topadi.
 */
function findBulkOutEndpoint(device) {
  for (const config of device.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        for (const ep of alt.endpoints) {
          if (ep.direction === 'out' && ep.type === 'bulk') {
            return { interfaceNumber: iface.interfaceNumber, endpointNumber: ep.endpointNumber };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Avval ilgari ruxsat berilgan qurilmalarni tekshiradi (so'ramasdan ulanadi).
 * Topilmasa, foydalanuvchidan brauzer orqali printerni tanlashni so'raydi.
 */
async function getOrConnectPrinter() {
  if (!isWebUSBSupported()) {
    throw new Error('Bu brauzer WebUSB\'ni qo\'llab-quvvatlamaydi. Chrome yoki Edge ishlating.');
  }

  let device = cachedDevice;

  if (!device) {
    const existing = await navigator.usb.getDevices();
    device = existing[0] || null;
  }

  if (!device) {
    device = await navigator.usb.requestDevice({ filters: [] });
  }

  await device.open();
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }

  const found = findBulkOutEndpoint(device);
  if (!found) {
    throw new Error('Printerda mos USB endpoint topilmadi.');
  }

  try {
    await device.claimInterface(found.interfaceNumber);
  } catch (e) {
    // Ba'zida interfeys allaqachon ushlangan bo'lishi mumkin - shunchaki davom etamiz
  }

  cachedDevice = device;
  cachedEndpoint = found.endpointNumber;
  cachedInterface = found.interfaceNumber;

  return device;
}

/**
 * Foydalanuvchidan birinchi marta printerni tanlashni so'raydi (ruxsat berish uchun).
 * Bu funksiyani albatta tugma bosilganda (click handler ichida) chaqiring -
 * brauzer xavfsizlik siyosati shuni talab qiladi.
 */
async function pairPrinter() {
  const device = await navigator.usb.requestDevice({ filters: [] });
  cachedDevice = null; // getOrConnectPrinter qayta ochsin
  return device;
}

/**
 * Tayyor ESC/POS bayt massivini printerga yuboradi.
 */
async function sendToPrinter(bytes) {
  const device = await getOrConnectPrinter();
  await device.transferOut(cachedEndpoint, bytes);
}

// ============================================================
// RASM (BITMAP) ORQALI CHOP ETISH
// Ekrandagi jadval ko'rinishini (chiziqlari bilan) aynan takrorlash uchun -
// matn buyruqlari o'rniga butun chekni rasmga aylantirib, printerga
// "raster bit image" sifatida yuboramiz. Shunda chiqadigan natija ekrandagi
// print-preview bilan bir xil ko'rinadi (jadval chiziqlari bilan).
// ============================================================

// 80mm qog'oz uchun odatiy bosib chiqarish kengligi (203dpi printerlar uchun
// ~576 nuqta). Agar chek juda keng/tor chiqsa, shu qiymatni o'zgartiring
// (masalan 512 yoki 384).
const PRINT_WIDTH_PX = 576;

/**
 * Butun kassa hujjatini <canvas> ustiga chizadi (jadval chiziqlari bilan) va
 * shu canvas elementini qaytaradi.
 */
function renderReceiptCanvas(data) {
  const W = PRINT_WIDTH_PX;
  const PAD = 18;
  const contentW = W - PAD * 2;

  // Avval balandlikni bilmaymiz - shuning uchun katta canvas yaratib, keyin
  // haqiqiy balandlikka moslab qirqamiz.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 4000;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  let y = PAD;

  function text(str, x, size, bold) {
    ctx.font = `${bold ? '700' : '400'} ${size}px Arial, sans-serif`;
    ctx.fillText(str, x, y);
  }

  function line(str, size = 18, bold = false) {
    text(str, PAD, size, bold);
    y += size + 6;
  }

  // Jadval chizish: header (ixtiyoriy, null bo'lsa yo'q) + qatorlar, chiziqlar bilan.
  // rows: [{ l, r, bold?, center? }, ...]
  function table(headerLeft, headerRight, rows, opts = {}) {
    const rowH = 30;
    const tableTop = y;
    const colSplit = Math.round(contentW * (opts.colSplit || 0.6));

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;

    const allRows = [];
    if (headerLeft !== null) allRows.push({ l: headerLeft, r: headerRight, header: true });
    rows.forEach((r) => allRows.push(r));

    const totalH = allRows.length * rowH;

    // Tashqi chegara
    ctx.strokeRect(PAD + 0.5, tableTop + 0.5, contentW, totalH);
    // Vertikal ajratuvchi chiziq
    ctx.beginPath();
    ctx.moveTo(PAD + colSplit + 0.5, tableTop);
    ctx.lineTo(PAD + colSplit + 0.5, tableTop + totalH);
    ctx.stroke();

    allRows.forEach((r, i) => {
      const rowY = tableTop + i * rowH;
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(PAD, rowY + 0.5);
        ctx.lineTo(PAD + contentW, rowY + 0.5);
        ctx.stroke();
      }
      const isBold = r.header || r.bold;
      const isCenter = r.header || r.center;
      const fontSize = isBold ? 20 : 18; // qoraytirilgan (bold) matn 1 pog'ona kattaroq
      const cy = rowY + (rowH - fontSize) / 2 - 2;
      ctx.font = `${isBold ? '700' : '400'} ${fontSize}px Arial, sans-serif`;
      if (isCenter) {
        ctx.textAlign = 'center';
        ctx.fillText(r.l, PAD + colSplit / 2, cy);
        ctx.fillText(r.r, PAD + colSplit + (contentW - colSplit) / 2, cy);
        ctx.textAlign = 'left';
      } else {
        ctx.fillText(String(r.l), PAD + 8, cy);
        ctx.textAlign = 'right';
        ctx.fillText(String(r.r), PAD + contentW - 8, cy);
        ctx.textAlign = 'left';
      }
    });

    y = tableTop + totalH + 14; // keyingi blokgacha tabiiy bo'shliq
  }

  // --- Sarlavha ---
  line(`Торговая Точка: ${data.spotName}`, 20, true);
  line(`Дата: ${data.date}`, 18, true);
  y += 6;

  // --- Rasxod jadvali (agar mavjud bo'lsa) ---
  if (data.expenses.length) {
    table('Расход', 'Сумма', data.expenses.map((e) => ({ l: e.name, r: e.amount.toLocaleString('ru-RU') })));
  }

  // --- Kupyura jadvali ---
  table('Купюра:', 'Количество', data.banknotes.map((b) => ({
    l: `${b.value.toLocaleString('ru-RU')} so'mlik`,
    r: b.count,
  })));

  // --- Umumiy Kassa bo'limi - 4 ta ALOHIDA blokka bo'lingan (Расход/Купюра
  // orasidagi kabi tabiiy bo'shliq bilan ajratilgan, oson farqlash uchun) ---
  table('Общая Касса', data.total.toLocaleString('ru-RU'), []);
  table(null, null, data.paytypes.map((p) => ({ l: p.name, r: p.amount.toLocaleString('ru-RU') })));
  table(null, null, [{ l: 'Общие Расходы', r: data.totalExpense.toLocaleString('ru-RU'), center: true }]);
  table(null, null, [{ l: 'Тоза', r: data.totalToza.toLocaleString('ru-RU'), bold: true, center: true }]);

  // --- Imzo qismi ---
  line('Ответственное лицо', 17, true);
  y += 22;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(PAD + contentW, y);
  ctx.stroke();
  y += 20;

  line('Супервайзер', 17, true);
  y += 22;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(PAD + contentW, y);
  ctx.stroke();
  y += PAD;

  // Canvas'ni haqiqiy balandlikka moslab qirqamiz
  const finalH = Math.ceil(y);
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = W;
  finalCanvas.height = finalH;
  const fctx = finalCanvas.getContext('2d');
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, W, finalH);
  fctx.drawImage(canvas, 0, 0, W, finalH, 0, 0, W, finalH);

  return finalCanvas;
}

/**
 * Canvas'ni ESC/POS "raster bit image" formatiga (GS v 0) o'giradi va
 * printerga bo'lib-bo'lib (chunk) yuboradi (juda katta rasmni bir yo'la
 * yubormaslik uchun, ba'zi printerlar buferi cheklangan bo'ladi).
 */
/**
 * Chop etib bo'lgach, USB portni BO'SHATADI - shunda Poster (yoki boshqa dastur)
 * xuddi shu printerdan yana foydalana oladi. Buni qilmasak, brauzer printerni
 * doimiy "band" qilib turadi va Poster o'z chekini chiqara olmay qoladi.
 */
async function releasePrinter() {
  if (!cachedDevice) return;
  try {
    await cachedDevice.releaseInterface(cachedInterface);
  } catch (e) {
    // e'tiborsiz - interfeys allaqachon bo'shatilgan bo'lishi mumkin
  }
  try {
    await cachedDevice.close();
  } catch (e) {
    // e'tiborsiz
  }
  cachedDevice = null;
  cachedEndpoint = null;
  cachedInterface = null;
}

async function printCanvasToUsb(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const imgData = ctx.getImageData(0, 0, W, H).data;
  const widthBytes = Math.ceil(W / 8);

  const CHUNK_H = 200;

  const init = new Uint8Array([ESC, 0x40]);
  await sendToPrinter(init);

  for (let startY = 0; startY < H; startY += CHUNK_H) {
    const h = Math.min(CHUNK_H, H - startY);
    const data = new Uint8Array(widthBytes * h);

    for (let row = 0; row < h; row++) {
      const y = startY + row;
      for (let xByte = 0; xByte < widthBytes; xByte++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit;
          if (x >= W) continue;
          const idx = (y * W + x) * 4;
          const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2], a = imgData[idx + 3];
          const luminance = (r * 0.3 + g * 0.59 + b * 0.11);
          const isBlack = a > 100 && luminance < 180;
          if (isBlack) byte |= (0x80 >> bit);
        }
        data[row * widthBytes + xByte] = byte;
      }
    }

    const xL = widthBytes & 0xff;
    const xH = (widthBytes >> 8) & 0xff;
    const yL = h & 0xff;
    const yH = (h >> 8) & 0xff;
    const header = new Uint8Array([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]);

    const packet = new Uint8Array(header.length + data.length);
    packet.set(header, 0);
    packet.set(data, header.length);
    await sendToPrinter(packet);
  }

  await sendToPrinter(new Uint8Array([0x0A, 0x0A, 0x0A, GS, 0x56, 0x00])); // feed + kesish
}

/**
 * Kassa hujjatini rasm sifatida (jadval chiziqlari bilan) USB printerga chop etadi.
 */
async function printReceiptAsImage(data) {
  const canvas = renderReceiptCanvas(data);
  try {
    await printCanvasToUsb(canvas);
  } finally {
    // Chop etish muvaffaqiyatli bo'lsa ham, xato bo'lsa ham - portni bo'shatamiz,
    // shunda Poster keyinroq printerga muammosiz murojaat qila oladi.
    await releasePrinter();
  }
}
