const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1180, height: 900 });
  await p.goto('http://localhost:4726/#seguridad', { waitUntil: 'load', timeout: 30000 }).catch(()=>{});
  await new Promise(r=>setTimeout(r,3500));
  await p.evaluate(()=>{ const el=document.getElementById('seguridad'); if(el) el.scrollIntoView(); });
  await new Promise(r=>setTimeout(r,800));
  await p.screenshot({ path: '/tmp/lincoin-seguridad.png' });
  console.log('done');
  await b.close();
})().catch(e=>console.log('ERR',e.message));
