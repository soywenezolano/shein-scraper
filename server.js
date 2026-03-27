const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/precio', async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).json({ error: 'Falta el parámetro url' });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const page = await context.newPage();
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    let finalUrl = page.url();
    
    // Si cae en captcha, extraer URL real del parámetro redirection
    if (finalUrl.includes('/risk/challenge') || finalUrl.includes('captcha')) {
      const urlObj = new URL(finalUrl);
      const redirection = urlObj.searchParams.get('redirection');
      if (redirection) {
        await page.goto(redirection, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);
        finalUrl = page.url();
      }
    }
    
    const datos = await page.evaluate(() => {
      const precioSelectors = [
        '.product-intro__head-price .from',
        '.product-intro__head-price span',
        '[class*="product-price"] span',
        '.price-new',
        '[data-price]',
        '.original-price',
        '.sale-price',
        '[class*="price"]'
      ];
      
      let precio = null;
      for (const sel of precioSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().match(/\$[\d.]+/)) {
          precio = el.textContent.trim();
          break;
        }
      }
      
      const nombreSelectors = [
        '.product-intro__head-name',
        'h1',
        '[class*="product-name"]',
        '.goods-name'
      ];
      
      let nombre = null;
      for (const sel of nombreSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 5) {
          nombre = el.textContent.trim();
          break;
        }
      }
      
      return { precio, nombre, titulo: document.title };
    });

    await browser.close();
    
    res.json({
      exito: true,
      url_final: finalUrl,
      precio: datos.precio,
      nombre: datos.nombre,
      titulo: datos.titulo
    });

  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ 
      exito: false, 
      error: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Shein scraper corriendo en puerto ${PORT}`);
});
