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

app.get('/precio', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Falta el parámetro url' });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    // Paso 1: Obtener URL real del producto con mobile UA
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

    // Extraer goods_id
    const matchId = productoUrl.match(/[-,]p-(\d+)-/);
    if (!matchId) {
      return res.json({ exito: false, error: 'No se pudo extraer ID del producto', url_final: productoUrl });
    }
    const goodsId = matchId[1];

    // Paso 2: Obtener HTML via ScraperAPI (HTTP directo)
    const desktopUrl = productoUrl
      .replace('https://m.shein.com/us/', 'https://us.shein.com/')
      .split('?')[0];

    const scraperUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(desktopUrl)}&render=true`;
    const html = await httpGet(scraperUrl);

    // Extraer precio con regex
    const precioMatch = html.match(/\$\d+\.\d{2}/);
    const precio = precioMatch ? precioMatch[0] : null;

    // Extraer nombre con regex
    const nombreMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const nombre = nombreMatch ? nombreMatch[1].trim() : null;

    res.json({
      exito: true,
      goods_id: goodsId,
      precio,
      nombre,
      url_producto: desktopUrl
    });

  } catch (error) {
    if (browser) try { await browser.close(); } catch(e) {}
    res.status(500).json({ exito: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Shein scraper corriendo en puerto ${PORT}`);
});
