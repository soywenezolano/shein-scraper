const express = require('express');
const { chromium } = require('playwright');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
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

app.get('/debug', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Falta url' });
  const scraperUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true&premium=true`;
  const html = await httpGet(scraperUrl);
  res.send(html.substring(0, 5000));
});

app.get('/precio', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Falta el parámetro url' });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const mobileContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await mobilePage.waitForTimeout(3000);

    let productoUrl = mobilePage.url();
    if (productoUrl.includes('/risk/challenge') || productoUrl.includes('captcha')) {
      const urlObj = new URL(productoUrl);
      productoUrl = urlObj.searchParams.get('redirection') || productoUrl;
    }
    await mobileContext.close();
    await browser.close();

    const matchId = productoUrl.match(/[-,]p-(\d+)-/);
    if (!matchId) {
      return res.json({ exito: false, error: 'No se pudo extraer ID del producto', url_final: productoUrl });
    }
    const goodsId = matchId[1];

    const apiUrl = `https://us.shein.com/api/productInfo/get_product_info_v2?goods_id=${goodsId}&currency=USD&lang=en&appVersion=1`;
    const scraperUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(apiUrl)}&premium=true`;
    const rawData = await httpGet(scraperUrl);

    let precio = null;
    let nombre = null;

    try {
      const data = JSON.parse(rawData);
      const info = data.info || data.data || data;
      const priceInfo = info.goods_price_info || info.priceInfo || {};
      precio = priceInfo.discountPrice?.amountWithSymbol
            || priceInfo.salePrice?.amountWithSymbol
            || priceInfo.retailPrice?.amountWithSymbol
            || null;
      nombre = info.goods_name || info.productTitle || info.title || null;
    } catch(e) {
      const precioMatch = rawData.match(/"amountWithSymbol"\s*:\s*"([^"]+)"/);
      const nombreMatch = rawData.match(/"goods_name"\s*:\s*"([^"]+)"/);
      precio = precioMatch ? precioMatch[1] : null;
      nombre = nombreMatch ? nombreMatch[1] : null;
    }

    res.json({ exito: true, goods_id: goodsId, precio, nombre, url_producto: productoUrl });

  } catch (error) {
    if (browser) try { await browser.close(); } catch(e) {}
    res.status(500).json({ exito: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Shein scraper corriendo en puerto ${PORT}`);
});
