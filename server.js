const express = require('express');
const { chromium } = require('playwright');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const options = { headers };
    lib.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/carrito', async (req, res) => {
  const cartUrl = req.query.url;
  if (!cartUrl) return res.status(400).json({ error: 'Falta el parámetro url' });

  const adspowerBase = process.env.ADSPOWER_URL;
  const adspowerKey = process.env.ADSPOWER_KEY;
  const profileId = process.env.ADSPOWER_PROFILE_ID;

  try {
    // Iniciar el browser de AdsPower
    const startResp = await httpGet(
      `${adspowerBase}/api/v1/browser/start?user_id=${profileId}`,
      { 'X-API-KEY': adspowerKey }
    );
    const startData = JSON.parse(startResp);

    if (startData.code !== 0) {
      return res.status(500).json({ error: 'No se pudo iniciar AdsPower', detalle: startData });
    }

    const wsEndpoint = startData.data.ws.puppeteer;
    const debugPort = startData.data.debug_port;

    // Conectar Playwright al browser de AdsPower
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const context = browser.contexts()[0];
    const page = await context.newPage();

    // Abrir el carrito
    await page.goto(cartUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Extraer artículos del carrito
    const articulos = await page.evaluate(() => {
      const items = [];
      const selectors = [
        '.cart-item',
        '[class*="cart-item"]',
        '[class*="goods-item"]',
        '.product-item'
      ];

      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          els.forEach(el => {
            const nombre = el.querySelector('[class*="name"], [class*="title"], h3, h4')?.textContent?.trim();
            const precio = el.querySelector('[class*="price"]')?.textContent?.trim();
            const talla = el.querySelector('[class*="size"], [class*="talla"]')?.textContent?.trim();
            if (nombre || precio) {
              items.push({ nombre, precio, talla });
            }
          });
          break;
        }
      }
      return items;
    });

    await page.close();

    // Cerrar el browser de AdsPower
    await httpGet(
      `${adspowerBase}/api/v1/browser/stop?user_id=${profileId}`,
      { 'X-API-KEY': adspowerKey }
    );

    res.json({ exito: true, total: articulos.length, articulos });

  } catch (error) {
    res.status(500).json({ exito: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Shein scraper corriendo en puerto ${PORT}`);
});
