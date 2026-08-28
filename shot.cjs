const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await p.goto('http://localhost:4723/', { waitUntil: 'load', timeout: 30000 }).catch(()=>{});
  await new Promise(r=>setTimeout(r,4000));
  await p.screenshot({ path: '/tmp/lincoin-mobile2.png' });
  console.log('done');
  await b.close();
})().catch(e=>console.log('ERR',e.message));
