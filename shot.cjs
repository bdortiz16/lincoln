const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 500, deviceScaleFactor: 2 });
  await p.goto('http://localhost:4725/', { waitUntil: 'load', timeout: 30000 }).catch(()=>{});
  await new Promise(r=>setTimeout(r,3500));
  await p.screenshot({ path: '/tmp/lincoin-topline.png' });
  console.log('done');
  await b.close();
})().catch(e=>console.log('ERR',e.message));
