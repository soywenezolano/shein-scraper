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
  res.send(html.substring(0, 3000));
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

    // Paso 2: Obtener HTML via ScraperAPI premium
    const desktopUrl = productoUrl
      .replace('https://m.shein.com/us/', 'https://us.shein.com/')
      .split('?')[0];

    const scraperUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(desktopUrl)}&render=true&premium=true`;
    const html = await httpGet(scraperUrl);

    // Buscar precio en JSON embebido en el HTML
    let precio = null;
    const precioPatterns = [
      /"amountWithSymbol"\s*:\s*"([^"]+)"/,
      /"salePrice"\s*:\s*\{[^}]*"amount"\s*:\s*"([\d.]+)"/,
      /"retailPrice"\s*:\s*\{[^}]*"amount"\s*:\s*"([\d.]+)"/,
      /"goods_price"\s*:\s*"([\d.]+)"/,
      /\$(\d+\.\d{2})/
    ];
    for (const pattern of precioPatterns) {
      const match = html.match(pattern);
      if (match) {
        precio = match[1].startsWith('$') ? match[1] : `$${match[1]}`;
        break;
      }
    }

    // Buscar nombre en JSON embebido
    let nombre = null;
    const nombrePatterns = [
      /"goods_name"\s*:\s*"([^"]+)"/,
      /"productTitle"\s*:\s*"([^"]+)"/,
      /<h1[^>]*>\s*([^<]{10,})\s*<\/h1>/i,
      /<title>\s*([^|<]{10,})\s*[|<]/i
    ];
    for (const pattern of nombrePatterns) {
      const match = html.match(pattern);
      if (match) {
        nombre = match[1].trim();
        break;
      }
    }

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
