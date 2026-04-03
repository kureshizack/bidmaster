const CACHE='cxi-v5';
const PRECACHE=['/','index.html','dashboard.html','login.html','scorer.html','scorecard.html','tournament.html','standings.html','join.html','matches.html','help.html','upgrade.html','player.html','auction.html','register.html','schedule.html','certificate.html','setup.html','bidder.html','viewer.html','admin.html','favicon.svg','cxi-modern.css','cxi-modern.js','cxi-seo.js','cxi-offline.js','cxi-player-stats.js'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  // Network first for API calls
  if(e.request.url.includes('supabase.co')||e.request.url.includes('googleapis')){return;}
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const rc=r.clone();caches.open(CACHE).then(c=>c.put(e.request,rc));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))));
});
