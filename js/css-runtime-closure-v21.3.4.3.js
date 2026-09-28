/* ==========================================================================
   GoodsbarnX — 21.3.4.3 CSS Runtime Closure
   Read-only diagnostic. Activate with ?css-closure=1.
   ========================================================================== */
(function(){
  "use strict";
  var V="V1.8.2.6.21.3.4.3";
  var REQUIRED=["css/main.css","css/components.css"];
  var CRITICAL=[
    ["app shell","#app"],["market screen","#screen-market"],["navigation","nav.bottom"],
    ["market hero",".hero"],["search",".search-bar-wrap"],["category grid",".category-grid"],
    ["distributor list","#distributor-list"],["buyer list","#buyer-list"],
    ["inquiry screen","#screen-inquiries"],["trust screen","#screen-trust"],
    ["profile screen","#screen-profile"],["upgrade screen","#screen-upgrade"],
    ["products screen","#screen-products"],["staff screen","#screen-staff"],
    ["cart screen","#screen-cart"],["bottom navigation","nav.bottom"]
  ];
  function row(name,state,detail){return {name:name,state:state,detail:detail};}
  function assetName(href){try{return new URL(href,location.href).pathname.replace(/^\//,"")}catch(e){return href||""}}
  function run(){
    var results=[],pass=true;
    var links=[].slice.call(document.querySelectorAll('link[rel="stylesheet"]'));
    REQUIRED.forEach(function(req){
      var hit=links.find(function(l){return assetName(l.href).endsWith(req)});
      if(!hit){pass=false;results.push(row("Stylesheet: "+req,"fail","Required stylesheet link is missing."));return;}
      var loaded=false;
      try{loaded=Array.from(document.styleSheets).some(function(ss){return ss.href&&assetName(ss.href).endsWith(req)});}catch(e){}
      if(loaded)results.push(row("Stylesheet: "+req,"pass","Resolved and present in document.styleSheets."));
      else{pass=false;results.push(row("Stylesheet: "+req,"fail","Linked asset is not present in the runtime CSSOM."));}
    });
    var styleTags=document.querySelectorAll("style");
    if(styleTags.length){pass=false;results.push(row("Inline style blocks","fail",styleTags.length+" <style> element(s) remain in the document."));}
    else results.push(row("Inline style blocks","pass","No runtime <style> element exists in index.html."));
    var inline=[].slice.call(document.querySelectorAll("[style]"));
    if(inline.length){pass=false;results.push(row("Inline style attributes","fail",inline.length+" element(s) still carry a style attribute."));}
    else results.push(row("Inline style attributes","pass","No element carries a static style attribute."));
    var app=document.getElementById("app");
    if(app && getComputedStyle(app).display!=="none")results.push(row("App shell computed display","pass","#app resolves to display="+getComputedStyle(app).display+"."));
    else{pass=false;results.push(row("App shell computed display","fail","#app is missing or resolves to display:none."));}
    CRITICAL.forEach(function(pair){
      var el=document.querySelector(pair[1]);
      if(!el){pass=false;results.push(row(pair[0],"fail","Critical selector not found: "+pair[1]));return;}
      var cs=getComputedStyle(el),rect=el.getBoundingClientRect();
      var displayOK=cs.display!=="none",sizeOK=(rect.width>0||el===document.getElementById("screen-inquiries")||el===document.getElementById("screen-trust")||el===document.getElementById("screen-profile")||el===document.getElementById("screen-upgrade")||el===document.getElementById("screen-products")||el===document.getElementById("screen-staff")||el===document.getElementById("screen-cart"));
      if(displayOK && sizeOK)results.push(row(pair[0],"pass","Computed display="+cs.display+"; width="+Math.round(rect.width)+"px."));
      else{pass=false;results.push(row(pair[0],"fail","Computed display="+cs.display+"; width="+Math.round(rect.width)+"px."));}
    });
    var forbidden=["depletion-transaction.js","distributor.js"];
    forbidden.forEach(function(x){if([].some.call(document.scripts,function(s){return s.src.indexOf(x)>=0})){pass=false;results.push(row("Forbidden legacy asset: "+x,"fail","Retired runtime asset is referenced."));}else results.push(row("Forbidden legacy asset: "+x,"pass","No runtime reference detected."));});
    console.group("GoodsbarnX — "+V+" CSS Runtime Closure");
    results.forEach(function(r){console.log((r.state==="pass"?"✓":"✕")+" "+r.name+" — "+r.detail);});
    console.log(pass?"CSS RUNTIME CLOSURE — PASS":"CSS RUNTIME CLOSURE — BLOCKED");
    console.groupEnd();
    window.GBX_CSS_RUNTIME_CLOSURE={version:V,pass:pass,results:results};
    return pass;
  }
  if(new URLSearchParams(location.search).get("css-closure")==="1")
    window.addEventListener("load",function(){setTimeout(run,0)});
  window.gbxRunCssRuntimeClosure=run;
})();
