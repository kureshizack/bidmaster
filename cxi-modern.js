/* ═══════════════════════════════════════════════════
   CaptainXI Modern JS — cxi-modern.js
   Drop this into any page for PWA + micro-interactions
   ═══════════════════════════════════════════════════ */

// ── KILL OLD SERVICE WORKER — was causing stale cache ──
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(regs=>{
    regs.forEach(r=>r.unregister());
  });
  // Clear all caches
  if(window.caches){
    caches.keys().then(names=>{
      names.forEach(name=>caches.delete(name));
    });
  }
}

// ── PWA INSTALL PROMPT ──
let _deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  _deferredPrompt=e;
  // Show install banner
  const banner=document.getElementById('pwaInstall');
  if(banner)banner.style.display='flex';
});
function installPWA(){
  if(!_deferredPrompt)return;
  _deferredPrompt.prompt();
  _deferredPrompt.userChoice.then(r=>{
    _deferredPrompt=null;
    const banner=document.getElementById('pwaInstall');
    if(banner)banner.style.display='none';
  });
}
function dismissPWA(){
  const banner=document.getElementById('pwaInstall');
  if(banner)banner.style.display='none';
  sessionStorage.setItem('pwa_dismissed','1');
}

// ── RIPPLE EFFECT ON PRIMARY BUTTONS ──
document.addEventListener('click',function(e){
  const btn=e.target.closest('.btn-primary,.btn-ghost,.plan-btn-primary,.submit-btn,.pwa-btn,.nav-cta');
  if(!btn)return;
  const rect=btn.getBoundingClientRect();
  const ripple=document.createElement('span');
  ripple.className='cxi-ripple';
  const size=Math.max(rect.width,rect.height);
  ripple.style.width=ripple.style.height=size+'px';
  ripple.style.left=(e.clientX-rect.left-size/2)+'px';
  ripple.style.top=(e.clientY-rect.top-size/2)+'px';
  if(!btn.style.position||btn.style.position==='static')btn.style.position='relative';
  btn.style.overflow='hidden';
  btn.appendChild(ripple);
  setTimeout(()=>ripple.remove(),500);
});

// ── UPGRADED TOAST ──
function showToast(msg,duration){
  let t=document.getElementById('toast')||document.querySelector('.toast');
  if(!t){
    t=document.createElement('div');
    t.className='toast';
    t.id='toast';
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.classList.add('show');
  t.style.display='block';
  clearTimeout(t._tid);
  t._tid=setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.style.display='none',300);},duration||2500);
}

// ── SKELETON HELPERS ──
function showSkeleton(containerId,count){
  const el=document.getElementById(containerId);
  if(!el)return;
  let html='';
  for(let i=0;i<(count||3);i++){
    html+='<div class="cxi-skeleton-card"><div class="cxi-skeleton cxi-skeleton-line w75"></div><div class="cxi-skeleton cxi-skeleton-line w50"></div><div class="cxi-skeleton cxi-skeleton-line w30"></div></div>';
  }
  el.innerHTML=html;
}

// ── HAPTIC FEEDBACK (if supported) ──
function haptic(type){
  if(navigator.vibrate){
    if(type==='light')navigator.vibrate(10);
    else if(type==='medium')navigator.vibrate(20);
    else if(type==='success')navigator.vibrate([10,50,10]);
    else if(type==='error')navigator.vibrate([30,50,30,50,30]);
  }
}

// ── GLOBAL BOTTOM NAVIGATION BAR ──
(function(){
  // Don't show on scorer (too busy) or bidder (auction mode)
  const page=location.pathname.split('/').pop()||'index.html';
  const hideOn=['scorer.html','bidder.html','viewer.html','login.html'];
  if(hideOn.includes(page))return;

  // Only show if user is logged in (check Supabase session in localStorage)
  let isLoggedIn=false;
  try{
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(key&&key.includes('auth-token')){
        const val=localStorage.getItem(key);
        if(val&&val.includes('access_token')){isLoggedIn=true;break;}
      }
    }
  }catch(e){}
  if(!isLoggedIn)return;

  // Create bottom nav
  const nav=document.createElement('div');
  nav.id='cxiBottomNav';
  const items=[
    {icon:'🏠',label:'Home',href:'/index.html',pages:['index.html','']},
    {icon:'📊',label:'Dashboard',href:'/dashboard.html',pages:['dashboard.html']},
    {icon:'🏆',label:'Tournaments',href:'/tournament.html',pages:['tournament.html','standings.html','schedule.html']},
    {icon:'⭐',label:'Upgrade',href:'/upgrade.html',pages:['upgrade.html']},
    {icon:'❓',label:'Help',href:'/help.html',pages:['help.html']}
  ];

  nav.innerHTML=items.map(item=>{
    const isActive=item.pages.includes(page);
    return '<a href="'+item.href+'" class="cxi-bnav-item'+(isActive?' active':'')+'">'
      +'<span class="cxi-bnav-icon">'+item.icon+'</span>'
      +'<span class="cxi-bnav-label">'+item.label+'</span>'
      +'</a>';
  }).join('');

  document.body.appendChild(nav);

  // Add padding to body so content isn't hidden behind nav
  document.body.style.paddingBottom='72px';
})();
