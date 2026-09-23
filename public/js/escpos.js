// USB termal printerga (masalan Xprinter XP-80C) to'g'ridan-to'g'ri ESC/POS
// baytlarini yuborish — Poster POS drayverni WinUSB'ga o'zgartirib qo'yganda
// oddiy window.print() ishlamay qoladi, shuning uchun WebUSB ishlatiladi.
// Chek matn buyruqlari bilan emas, Canvas'da chizilib bitmap (rasm) sifatida
// yuboriladi — shunda jadval chiziqlari chiroyli chiqadi.
// MUHIM: chop etishdan keyin USB port har doim (finally blokida) bo'shatiladi —
// aks holda brauzer printerni band qilib qo'yadi va Poster o'z chekini
// chiqara olmay qoladi.

const PRINTER_WIDTH_PX = 384; // 80mm termal printer uchun odatiy piksel kengligi

async function getUsbDevice() {
  const filters = [
    { vendorId: 0x0483 }, // ko'p Xprinter modellari shu vendor ID orqali tanilgan
  ];
  try {
    let device = await navigator.usb.requestDevice({ filters });
    return device;
  } catch (e) {
    throw new Error("USB printer tanlanmadi");
  }
}

function drawReceiptCanvas(entry, paymentTypes) {
  const canvas = document.createElement('canvas');
  canvas.width = PRINTER_WIDTH_PX;
  const lineH = 26;
  const paymentRows = paymentTypes.filter((p) => Number((entry.payment_amounts || {})[p.id]) > 0);
  const rows = 10 + paymentRows.length;
  canvas.height = rows * lineH + 40;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  let y = 10;
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('MONDO REGION', canvas.width / 2, y); y += lineH + 4;
  ctx.font = '14px monospace';
  ctx.fillText(`Kassa hisoboti — ${entry.business_date}`, canvas.width / 2, y); y += lineH;

  ctx.strokeStyle = '#000';
  ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(canvas.width - 8, y); ctx.stroke(); y += 10;

  ctx.textAlign = 'left';
  ctx.font = '15px monospace';
  const line = (label, value) => {
    ctx.fillText(label, 10, y);
    ctx.textAlign = 'right';
    ctx.fillText(value, canvas.width - 10, y);
    ctx.textAlign = 'left';
    y += lineH;
  };

  line('Тоза (naqd):', String(Math.round(entry.toza_naqd || 0)));
  line('Rasxod:', String(Math.round(entry.rasxod || 0)));
  line('Inkassatsiya:', String(Math.round(entry.inkassatsiya || 0)));
  line('Smena farqi:', String(Math.round(entry.smena_farqi || 0)));
  paymentRows.forEach((p) => line(p.name + ':', String(Math.round(entry.payment_amounts[p.id] || 0))));
  line('Сертификат:', String(Math.round(entry.sertifikat_amount || 0)));

  ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(canvas.width - 8, y); ctx.stroke(); y += 10;
  ctx.font = 'bold 18px monospace';
  line('JAMI:', String(Math.round(entry.jami || 0)));

  return canvas;
}

function canvasToEscposRaster(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height).data;

  const widthBytes = Math.ceil(width / 8);
  const raster = new Uint8Array(widthBytes * height);

  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const idx = (yy * width + xx) * 4;
      const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2], a = imgData[idx + 3];
      const luminance = (r * 0.3 + g * 0.59 + b * 0.11);
      const isBlack = a > 10 && luminance < 200;
      if (isBlack) {
        const byteIndex = yy * widthBytes + (xx >> 3);
        raster[byteIndex] |= (0x80 >> (xx % 8));
      }
    }
  }

  // GS v 0 — raster bit image chop etish buyrug'i
  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
  const cut = new Uint8Array([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]); // 3 qator + kesish

  const out = new Uint8Array(header.length + raster.length + cut.length);
  out.set(header, 0);
  out.set(raster, header.length);
  out.set(cut, header.length + raster.length);
  return out;
}

async function printCashReceipt(entry, paymentTypes, statusEl) {
  if (!navigator.usb) {
    if (statusEl) statusEl.textContent = "Brauzer WebUSB'ni qo'llab-quvvatlamaydi";
    return;
  }
  let device = null;
  try {
    if (statusEl) statusEl.textContent = 'Printer tanlanmoqda...';
    device = await getUsbDevice();
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    const iface = device.configuration.interfaces.find((i) =>
      i.alternates.some((a) => a.interfaceClass === 0x07) // printer class
    ) || device.configuration.interfaces[0];
    await device.claimInterface(iface.interfaceNumber);

    const altSetting = iface.alternates[0];
    const outEndpoint = altSetting.endpoints.find((e) => e.direction === 'out');
    if (!outEndpoint) throw new Error("Printerda chiqish endpointi topilmadi");

    if (statusEl) statusEl.textContent = 'Chek chizilmoqda...';
    const canvas = drawReceiptCanvas(entry, paymentTypes);
    const bytes = canvasToEscposRaster(canvas);

    if (statusEl) statusEl.textContent = 'Chop etilmoqda...';
    await device.transferOut(outEndpoint.endpointNumber, bytes);

    if (statusEl) statusEl.textContent = 'Chek chop etildi';
  } catch (e) {
    if (statusEl) statusEl.textContent = `Xato: ${e.message}`;
  } finally {
    // MUHIM: har doim bo'shatiladi — aks holda Poster o'z chekini chiqara olmay qoladi.
    if (device) {
      try { await device.releaseInterface(0); } catch (e) { /* allaqachon bo'shatilgan bo'lishi mumkin */ }
      try { await device.close(); } catch (e) { /* ignore */ }
    }
  }
}
