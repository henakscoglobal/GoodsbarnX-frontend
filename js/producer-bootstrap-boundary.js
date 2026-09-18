/* GoodsbarnX V1.8.2.6.8.1.1.7.3.2 — Producer Trace Bootstrap Boundary
   Diagnostic only. No writes, no data mutation, no allocation logic changes.
*/
(function(){
  "use strict";
  var V="V1.8.2.6.8.1.1.7.3.2", running=false;
  var rootId="gbx-v1832-producer-bootstrap";
  function esc(v){return String(v??"").replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]})}
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
  function timeout(p,ms,label){return Promise.race([p,new Promise(function(_,rej){setTimeout(function(){rej(new Error(label+" timed out after "+ms+"ms."))},ms)})])}
  function out(){return document.getElementById(rootId+"-out")}
  function row(name,state,detail){var d=document.createElement("div");d.className="gbx1832-row "+state;d.innerHTML='<span class="gbx1832-dot"></span><div><b>'+esc(name)+'</b><small>'+esc(detail||"")+'</small></div>';return d}
  function setRows(rows,headline){var el=out();if(!el)return;el.innerHTML="";var h=document.createElement("div");h.className="gbx1832-headline";h.textContent=headline||"";el.appendChild(h);rows.forEach(function(r){el.appendChild(row(r[0],r[1],r[2]))})}
  async function waitFor(name,fn,ms){var started=performance.now(),last=null;while(performance.now()-started<ms){try{var v=fn();if(v)return v}catch(e){last=e}await sleep(250)}throw last||new Error(name+" not available within "+ms+"ms.")}
  async function run(){
    if(running)return;running=true;
    var rows=[];setRows([["Diagnostic loaded","pass",V+" executing."],["Application state","info","Bounded bootstrap started; no indefinite waiting."]],"BOOTSTRAPPING PRODUCER TRACE…");
    try{
      if(!window.sb||!sb.auth||typeof sb.auth.getUser!=="function")throw new Error("Supabase auth client is unavailable.");
      rows.push(["Supabase client","pass","sb.auth.getUser() is available."]);
      var au=await timeout(sb.auth.getUser(),8000,"Authoritative auth-user resolution");
      if(au.error)throw au.error;
      var user=au.data&&au.data.user;
      if(!user)throw new Error("Supabase returned no authenticated user.");
      rows.push(["Auth user","pass","Authenticated user resolved: "+user.id]);
      var pr=await timeout(sb.from("profiles").select("id,role,full_name").eq("id",user.id).single(),8000,"Canonical profile resolution");
      if(pr.error)throw pr.error;
      if(!pr.data)throw new Error("Canonical profile row is missing.");
      rows.push(["Profile","pass","role="+String(pr.data.role||"")]);
      if(String(pr.data.role||"").toLowerCase()!=="distributor")throw new Error("Authenticated profile is not a distributor.");
      var dp=await timeout(sb.from("distributor_profiles").select("id").eq("id",user.id).single(),8000,"Distributor profile resolution");
      if(dp.error)throw dp.error;
      rows.push(["Distributor principal","pass","Distributor profile resolved."]);
      var producer=await waitFor("refreshDepletorAllocation",function(){return typeof window.refreshDepletorAllocation==="function"?window.refreshDepletorAllocation:null},5000);
      rows.push(["Allocation producer","pass","refreshDepletorAllocation is present."]);
      var loaded=await waitFor("Depletor allocation version",function(){return window.goodsbarnxDepletorAllocationVersion||null},5000);
      rows.push(["Depletor runtime","pass","Loaded allocation runtime "+loaded+"."]);
      var source="",sourceStatus="unread";
      try{var fr=await timeout(fetch("js/depletor.js?gbx_bootstrap_trace="+Date.now(),{cache:"no-store"}),8000,"Served depletor source fetch");if(!fr.ok)throw new Error("HTTP "+fr.status);source=await fr.text();sourceStatus="served";rows.push(["Served producer source","pass","depletor.js fetched from deployed runtime."])}catch(e){sourceStatus="fetch_failed";rows.push(["Served producer source","warn",e.message||String(e)])}
      var beforeDesc=Object.getOwnPropertyDescriptor(window,"goodsbarnxAllocationCandidates"),beforeVal=window.goodsbarnxAllocationCandidates;
      var pushed=[],assigned=[];
      var origPush=Array.prototype.push;
      Array.prototype.push=function(){for(var i=0;i<arguments.length;i++){var x=arguments[i];if(x&&x.inquiryId&&x.productId&&Object.prototype.hasOwnProperty.call(x,"routeStatus")){pushed.push({inquiryId:x.inquiryId,productId:x.productId,routeStatus:x.routeStatus,allocatableQuantity:x.allocatableQuantity,routeType:x.routeType})}}return origPush.apply(this,arguments)};
      try{
        Object.defineProperty(window,"goodsbarnxAllocationCandidates",{configurable:true,get:function(){return beforeVal},set:function(v){if(Array.isArray(v))assigned.push({count:v.length,invalidRefs:v.filter(function(x){return x&&x.inquiryId==="51ff22a4-80b4-4cdf-bec6-e2ee33bc74fb"}).length});beforeVal=v}});
        rows.push(["Producer invocation","info","Invoking the proven allocation producer directly."]);
        var result=await timeout(Promise.resolve().then(function(){return producer()}),12000,"refreshDepletorAllocation execution");
        var count=Array.isArray(result)?result.length:null;
        rows.push(["Producer invocation","pass","Producer returned "+(count===null?"a non-array result":count+" candidates")+"."]);
      }catch(e){rows.push(["Producer invocation","fail",e.message||String(e)]);throw e}
      finally{
        Array.prototype.push=origPush;
        try{if(beforeDesc)Object.defineProperty(window,"goodsbarnxAllocationCandidates",beforeDesc);else{delete window.goodsbarnxAllocationCandidates;if(typeof beforeVal!=="undefined")window.goodsbarnxAllocationCandidates=beforeVal}}catch(e){}
      }
      var invalid="51ff22a4-80b4-4cdf-bec6-e2ee33bc74fb";
      var invalidPushes=pushed.filter(function(x){return x.inquiryId===invalid});
      var invalidAssignments=assigned.reduce(function(n,x){return n+(x.invalidRefs||0)},0);
      rows.push(["Candidate construction capture",invalidPushes.length?"fail":"pass",invalidPushes.length?invalidPushes.length+" invalid candidate construction(s) observed for inquiry "+invalid: "No invalid inquiry candidate construction observed."]);
      rows.push(["Candidate-surface assignment",invalidAssignments?"fail":"pass",assigned.length+" assignment event(s); "+invalidAssignments+" invalid inquiry reference(s) observed."]);
      var hasGate=source?/(?:INVALID|invalid).{0,180}(?:continue|return|filter)|(?:continue|return|filter).{0,180}(?:INVALID|invalid)/s.test(source):false;
      rows.push(["Early invalid-evidence gate",hasGate?"pass":"fail",hasGate?"Served producer source contains an invalid-evidence exclusion pattern.":"No early invalid-evidence exclusion gate detected in served depletor source."]);
      var finalState=invalidPushes.length||invalidAssignments?"BLOCKED — invalid demand evidence reaches candidate construction/output.":(hasGate?"PASS — producer executed and invalid evidence was excluded.":"BLOCKED — producer executed, but no early invalid-evidence gate exists.");
      var h=out();var banner=document.createElement("div");banner.className="gbx1832-final "+(finalState.indexOf("PASS")===0?"pass":"fail");banner.innerHTML="<strong>"+esc(finalState)+"</strong>";h.appendChild(banner);
      var detail=document.createElement("pre");detail.className="gbx1832-detail";detail.textContent=JSON.stringify({build:V,invalidInquiryId:invalid,servedSource:sourceStatus,candidateConstructions:pushed,candidateAssignments:assigned},null,2);h.appendChild(detail);
    }catch(e){
      rows.push(["Bootstrap boundary","fail",e.message||String(e)]);
      setRows(rows,"BOOTSTRAP TRACE STOPPED — EXACT FAILURE CAPTURED");
      running=false;return;
    }
    setRows(rows,"CONTROLLED PRODUCER TRACE COMPLETE");
    running=false;
  }
  function mount(){
    var panel=document.getElementById("depletor-console");if(!panel||document.getElementById(rootId))return;
    var s=document.createElement("section");s.id=rootId;s.className="gbx1832-panel";s.innerHTML='<div class="gbx1832-kicker">'+V+' · PRODUCER TRACE BOOTSTRAP</div><h3>Producer Bootstrap Boundary</h3><p>Bounded diagnostic. It resolves auth directly, verifies the distributor principal, then executes the existing allocation producer. No allocation logic, inquiry, stock, relationship, or Supabase writes are performed.</p><button id="'+rootId+'-run" type="button">RUN CONTROLLED TRACE</button><div id="'+rootId+'-out" aria-live="polite"></div>';
    var anchor=panel.querySelector(".depletor-heading")||panel.firstElementChild;if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(s,anchor);else panel.prepend(s);
    document.getElementById(rootId+"-run").addEventListener("click",run);
    setTimeout(run,350);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
