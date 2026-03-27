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
    });

    const page = await context.newPage();
    
    // Navegar al link para obtener la URL real del producto
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);
    
    let productoUrl = page.url();
    
    // Si cae en captcha, extraer URL real del parámetro redirection
    if (productoUrl.includes('/risk/challenge') || productoUrl.includes('captcha')) {
      const urlObj = new URL(productoUrl);
      const redirection = urlObj.searchParams.get('redirection');
      if (redirection) {
        productoUrl = redirection;
      }
    }
    
    // Extraer goods_id del URL del producto
    const matchId = productoUrl.match(/[-,]p-(\d+)-/);
    if (!matchId) {
      await browser.close();
      return res.json({ exito: false, error: 'No se pudo extraer el ID del producto', url_final: productoUrl });
    }
    
    const goodsId = matchId[1];
    
    // Consultar API de Shein directamente
    const apiUrl = `https://us.shein.com/api/productInfo/get_product_info_v2?goods_id=${goodsId}&currency=USD&lang=en`;
    
    const apiResponse = await page.evaluate(async (apiUrl) => {
      try {
        const resp = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://us.shein.com/'
          }
        });
        return await resp.json();
      } catch(e) {
        return null;
      }
    }, apiUrl);
    
    await browser.close();
    
    if (apiResponse && apiResponse.info && apiResponse.info.goods_price_info) {
      const priceInfo = apiResponse.info.goods_price_info;
      const nombre = apiResponse.info.goods_name || apiResponse.info.goods_name_en || '';
      const precio = priceInfo.discountPrice?.amountWithSymbol || priceInfo.salePrice?.amountWithSymbol || null;
      
      return res.json({
        exito: true,
        goods_id: goodsId,
        precio,
        nombre,
        url_producto: productoUrl
      });
    }
    
    res.json({ 
      exito: false, 
      error: 'No se pudo obtener precio de la API',
      goods_id: goodsId,
      url_producto: productoUrl,
      api_response: apiResponse
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
