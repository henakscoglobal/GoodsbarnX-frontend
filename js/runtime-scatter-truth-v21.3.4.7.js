/*
  GoodsbarnX — V1.8.2.6.21.3.4.7
  RUNTIME SCATTER TRUTH TEST — READ ONLY
  Purpose: identify duplicate runtime producers without modifying production UI.
*/
(function(){
  'use strict';
  const V='V1.8.2.6.21.3.4.7';
  const MARKER=V+'-RUNTIME-SCATTER-TRUTH';
  const TEST_FILE='runtime-scatter-truth-v21.3.4.7.js';
  const BASELINE={sections:7,buttons:48,divs:363,styles:5,inlineStyles:26};
  const EXPECTED_DUPLICATE_ID={id:'goodsbarnx-distributor-v111',allowedCount:2,reason:'intentional style+script pair in recovered 21.3.3 baseline'};
  const KNOWN_GOOD_HASHES={
    'auth.js':'ccf41cbccd591a36dc1a0b86e005fd9fc2c849b2d8c6ae1d3004573014d50cff',
    'app.js':'417ac7680ad32233ae3d7013201249fd6075289221b91467c44bf84188337cce',
    'main.css':'809cd6d6242a67d08b286e0b0461f2e920385fb49e65c66a2ae4f4856a0d9239',
    'components.css':'c6295c7423ff53de1db82ad4a55db6c41de669460411f68eaba8fc42cc784d77'
  };
  let result;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  async function sha256(text){const b=new TextEncoder().encode(text);const h=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('');}
  function normPath(u){try{return new URL(u,document.baseURI).pathname.replace(/^\//,'')}catch(e){return String(u||'').replace(/^\//,'')}}
  function localScripts(){return [...document.scripts].map(s=>normPath(s.src)).filter(Boolean).filter(p=>!p.endsWith(TEST_FILE));}
  function countId(id){return document.querySelectorAll('#'+CSS.escape(id)).length;}
  function sourceFlags(src){
    return {
      dashboardBlock:/Distributor dashboard\s*[—-]\s*migrated from the old inline runtime/i.test(src),
      dashboardObject:/gbxDistributorDashboard/.test(src),
      dashboardLoader:/loadDistributorDashboard/.test(src),
      migrationMarker:/21\.3\.4\.2:\s*Distributor dashboard runtime migrated to js\/market\.js/i.test(src),
      dashboardId:/gbx-distributor-dashboard/.test(src)
    };
  }
  function stripSelfFromHtml(src){
    return src
      .replace(/\s*<!--\s*V1\.8\.2\.6\.21\.3\.4\.7[^>]*-->\s*<script[^>]+runtime-scatter-truth-v21\.3\.4\.7\.js[^>]*><\/script>/gi,'')
      .replace(/\s*<script[^>]+runtime-scatter-truth-v21\.3\.4\.7\.js[^>]*><\/script>/gi,'');
  }
  async function run(){
    const lines=[V+' — RUNTIME SCATTER TRUTH TEST','READ-ONLY · NO DOM/CSS/SUPABASE MUTATION'];
    const issues=[]; const warnings=[];
    try{
      const live=await fetch(location.href,{cache:'no-store',credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('index fetch '+r.status);return r.text();});
      const normalized=stripSelfFromHtml(live);
      const dashboardInline=(live.match(/id=["']goodsbarnx-distributor-v111["']/gi)||[]).length;
      const inlineDashboardScript=/<script[^>]*id=["']goodsbarnx-distributor-v111["'][^>]*>/i.test(live);
      const inlineDashboardStyle=/<style[^>]*id=["']goodsbarnx-distributor-v111["'][^>]*>/i.test(live);
      const domShape={sections:document.querySelectorAll('section').length,buttons:document.querySelectorAll('button').length,divs:document.querySelectorAll('div').length,styles:document.querySelectorAll('style').length,inlineStyles:document.querySelectorAll('[style]').length};
      lines.push('','BASELINE SHAPE');
      lines.push('✓ Expected recovered 21.3.3 envelope: '+JSON.stringify(BASELINE));
      lines.push((Object.keys(BASELINE).every(k=>domShape[k]===BASELINE[k])?'✓':'⚠')+' Current DOM envelope: '+JSON.stringify(domShape));
      lines.push('','KNOWN-GOOD DASHBOARD ID');
      lines.push('✓ goodsbarnx-distributor-v111 count '+dashboardInline+' (baseline intentionally has style+script with same id)');
      if(dashboardInline!==2) issues.push('Unexpected goodsbarnx-distributor-v111 source count: '+dashboardInline+'; recovered baseline count is 2.');
      if(!inlineDashboardScript||!inlineDashboardStyle) issues.push('Recovered inline distributor dashboard pair is incomplete.');
      lines.push('','LIVE MARKET.JS SOURCE');
      const marketUrl=new URL('js/market.js',location.href).href;
      const market=await fetch(marketUrl,{cache:'no-store',credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('market.js fetch '+r.status);return r.text();});
      const mf=sourceFlags(market);
      lines.push((mf.dashboardBlock?'✗':'✓')+' migrated-dashboard block in live market.js: '+mf.dashboardBlock);
      lines.push((mf.dashboardObject?'✗':'✓')+' gbxDistributorDashboard object in live market.js: '+mf.dashboardObject);
      lines.push((mf.dashboardLoader?'✗':'✓')+' loadDistributorDashboard in live market.js: '+mf.dashboardLoader);
      lines.push('dashboard source size: '+market.length+' bytes');
      if(mf.dashboardBlock||mf.dashboardObject||mf.migrationMarker) issues.push('LIVE market.js still contains the 21.3.4.2 migrated distributor-dashboard runtime.');
      if(mf.dashboardId) issues.push('LIVE market.js contains a producer for #gbx-distributor-dashboard.');
      const scripts=localScripts();
      lines.push('','PRODUCTION SCRIPT ORDER');
      lines.push(JSON.stringify(scripts));
      const ai=scripts.indexOf('js/app.js');
      if(ai<0) issues.push('app.js is not present in production script order.');
      else if(scripts.slice(ai+1).length) issues.push('Production scripts execute after app.js: '+JSON.stringify(scripts.slice(ai+1)));
      const assets=['auth.js','app.js','main.css','components.css'];
      lines.push('','KNOWN-GOOD ASSET HASHES (NO-STORE)');
      for(const name of assets){
        const u=new URL((name.endsWith('.css')?'css/':'js/')+name,location.href).href;
        try{const txt=await fetch(u,{cache:'no-store',credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error(String(r.status));return r.text()});const h=await sha256(txt);const ok=h===KNOWN_GOOD_HASHES[name];lines.push((ok?'✓':'✗')+' '+name+' sha256='+h+(KNOWN_GOOD_HASHES[name]?' expected='+KNOWN_GOOD_HASHES[name]:''));if(!ok)issues.push('Asset hash mismatch: '+name);}catch(e){issues.push('Asset fetch failed: '+name+' · '+e.message);}
      }
      lines.push('','CACHE / SERVICE WORKER');
      lines.push('✓ serviceWorker.controller='+(navigator.serviceWorker&&navigator.serviceWorker.controller?navigator.serviceWorker.controller.scriptURL:'none'));
      if('caches' in window){try{const keys=await caches.keys();lines.push('CacheStorage keys='+JSON.stringify(keys));if(keys.length)warnings.push('Browser CacheStorage contains '+keys.length+' cache(s); this is a possible stale-asset source, not proof by itself.');}catch(e){warnings.push('CacheStorage inspection unavailable: '+e.message)}}
      lines.push('','DOM DUPLICATE-ID ANALYSIS');
      const ids=[...new Set([...document.querySelectorAll('[id]')].map(e=>e.id).filter(Boolean))];
      let dup=0;ids.forEach(id=>{const c=countId(id);if(c>1){dup++;if(id===EXPECTED_DUPLICATE_ID.id)lines.push('✓ expected duplicate '+id+' ×'+c+' (style+script source IDs)');else{issues.push('Unexpected duplicate DOM ID '+id+' ×'+c);lines.push('✗ duplicate '+id+' ×'+c)}}});
      if(!dup)lines.push('✓ no duplicate DOM IDs');
      lines.push('','DASHBOARD PRODUCER COUNT');
      const runtimeProducer=mf.dashboardObject||mf.dashboardBlock||mf.dashboardId;
      const inlineProducer=inlineDashboardScript;
      lines.push('inline dashboard producer='+inlineProducer);
      lines.push('external market.js dashboard producer='+runtimeProducer);
      if(inlineProducer&&runtimeProducer){issues.push('TWO dashboard producers are active in the architecture: inline 1.1.1 + market.js migrated runtime. This is the direct duplicate-render path.');lines.push('✗ TWO PRODUCERS DETECTED — direct scatter mechanism');}
      else lines.push('✓ single dashboard producer');
      lines.push('','BOUNDARY RESULT');
      if(issues.length){lines.push('✗ '+V+' — BLOCKED');issues.forEach(x=>lines.push('  • '+x));}
      else lines.push('✓ '+V+' — PASS · no duplicate dashboard producer detected');
      if(warnings.length){lines.push('','WARNINGS');warnings.forEach(x=>lines.push('  ⚠ '+x));}
      result={version:V,marker:MARKER,status:issues.length?'BLOCKED':'PASS',issues,warnings,lines};
    }catch(e){result={version:V,marker:MARKER,status:'BLOCKED',issues:[e.message||String(e)],warnings:[],lines:[...lines,'','✗ '+V+' — BLOCKED','  • '+(e.message||String(e))]};}
    window.goodsbarnxRuntimeScatterTruth=result;
    console.group('GoodsbarnX — '+V);result.lines.forEach(x=>console.log(x));console.groupEnd();
    if(new URLSearchParams(location.search).get('scattertruth')==='1'){
      let p=document.getElementById('gbx-runtime-scatter-truth');if(p)p.remove();
      p=document.createElement('pre');p.id='gbx-runtime-scatter-truth';p.textContent=result.lines.join('\n');
      p.style.cssText='position:fixed;z-index:2147483647;left:8px;right:8px;bottom:8px;max-height:70vh;overflow:auto;padding:14px;border:2px solid #D6A83A;border-radius:14px;background:#0F1411;color:#F5F3EC;font:11px/1.45 monospace;white-space:pre-wrap;box-shadow:0 18px 50px rgba(0,0,0,.4)';document.body.appendChild(p);
    }
    return result;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(run,2500),{once:true});else setTimeout(run,2500);
})();
