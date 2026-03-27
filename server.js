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

       // Paso 2: Construir URL desktop desde la URL mobile del producto
    const desktopUrl = productoUrl
      .replace('https://m.shein.com/us/', 'https://us.shein.com/')
      .split('?')[0]; // quitar query params

    const desktopContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const desktopPage = await desktopContext.newPage();
    const scraperUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(desktopUrl)}&render=true`;
await desktopPage.goto(scraperUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    
    // Esperar que cargue el precio
    try {
      await desktopPage.waitForSelector('[class*="price"]', { timeout: 10000 });
    } catch(e) {}
    
    await desktopPage.waitForTimeout(3000);

    const datos = await desktopPage.evaluate(() => {
      // Buscar cualquier elemento con precio en dólares
      const allEls = document.querySelectorAll('*');
      let precio = null;
      let precioEl = null;
      
      for (const el of allEls) {
        if (el.children.length === 0) { // solo elementos hoja
          const text = el.textContent.trim();
          if (text.match(/^\$[\d.]+$/) || text.match(/^\$[\d,]+\.\d{2}$/)) {
            precio = text;
            precioEl = el.className;
            break;
          }
        }
      }

      const h1 = document.querySelector('h1');
      const nombre = h1 ? h1.textContent.trim() : null;

      return { precio, nombre, precioEl, titulo: document.title, finalUrl: window.location.href };
    });

    await browser.close();

    res.json({
      exito: true,
      goods_id: goodsId,
      precio: datos.precio,
      nombre: datos.nombre,
      clase_precio: datos.precioEl,
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
