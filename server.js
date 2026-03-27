const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

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

    // Paso 1: Obtener URL real con mobile UA
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

    // Extraer goods_id
    const matchId = productoUrl.match(/[-,]p-(\d+)-/);
    if (!matchId) {
      await browser.close();
      return res.json({ exito: false, error: 'No se pudo extraer ID del producto', url_final: productoUrl });
    }
    const goodsId = matchId[1];

    // Paso 2: Scrape con desktop UA en shein.com
    const desktopContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const desktopPage = await desktopContext.newPage();
    const desktopUrl = `https://us.shein.com/product/index.html?goods_id=${goodsId}`;
    await desktopPage.goto(desktopUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await desktopPage.waitForTimeout(5000);

    const datos = await desktopPage.evaluate(() => {
      const precioSelectors = [
        '.product-intro__head-price .from',
        '.product-intro__head-price span',
        '[class*="product-price"] span',
        '.she-color-red',
        '[class*="price-info"] span',
        '[class*="price"]'
      ];
      let precio = null;
      for (const sel of precioSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = el.textContent.trim();
          if (text.match(/\$[\d.]+/)) {
            precio = text;
            break;
          }
        }
        if (precio) break;
      }

      const h1 = document.querySelector('h1');
      const nombre = h1 ? h1.textContent.trim() : document.title;

      return { precio, nombre, titulo: document.title, finalUrl: window.location.href };
    });

    await browser.close();

    res.json({
      exito: true,
      goods_id: goodsId,
      precio: datos.precio,
      nombre: datos.nombre,
      url_producto: datos.finalUrl
    });

  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ exito: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Shein scraper corriendo en puerto ${PORT}`);
});
