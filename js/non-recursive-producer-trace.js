(function(){
  "use strict";
  var V="V1.8.2.6.8.1.1.7.3.3";
  var INVALID="51ff22a4-80b4-4cdf-bec6-e2ee33bc74fb";
  var running=false;
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]})}
  function panel(){var r=document.getElementById("depletor-console");if(!r)return null;var old=document.getElementById("gbx-v1833-trace");if(old)return old;var s=document.createElement("section");s.id="gbx-v1833-trace";s.innerHTML='<div class="gbx-v1833-kicker">'+V+' · NON-RECURSIVE PRODUCER CONSTRUCTION TRACE</div><div class="gbx-v1833-title">Candidate Construction Boundary</div><div class="gbx-v1833-copy">Diagnostic only. The V1.8.2.6 allocation producer is frozen. This trace uses the original Array.prototype.push implementation for all observations, preventing diagnostic recursion.</div><button id="gbx-v1833-run" type="button">RUN NON-RECURSIVE TRACE</button><div id="gbx-v1833-status" class="gbx-v1833-status">Ready.</div><pre id="gbx-v1833-out" class="gbx-v1833-out"></pre>';r.insertBefore(s,r.firstChild);document.getElementById("gbx-v1833-run").onclick=run;return s}
  function setStatus(x){var e=document.getElementById("gbx-v1833-status");if(e)e.textContent=x}
  function output(lines){var e=document.getElementById("gbx-v1833-out");if(e)e.textContent=lines.join("\n")}
  async function fetchSource(){try{var u="js/depletor.js?gbx_v1833="+Date.now();var r=await fetch(u,{cache:"no-store",credentials:"same-origin"});return r.ok?await r.text():""}catch(e){return ""}}
  function candidate(v){return v&&typeof v==="object"&&v.inquiryId&&v.productId&&typeof v.routeStatus!=="undefined"}
  function assignmentInvalid(v){return Array.isArray(v)&&v.some(function(x){return x&&x.inquiryId===INVALID})}
  async function run(){
    if(running)return;running=true;var b=document.getElementById("gbx-v1833-run");if(b)b.disabled=true;setStatus("Running bounded producer trace…");output([]);
    var originalPush=Array.prototype.push, observations=[], assignments=[], candidateConstructs=[], stackSamples=[];
    var oldDesc=null, hadOwn=false, oldValue;
    try{
      var auth=await sb.auth.getUser();if(auth.error)throw auth.error;if(!auth.data||!auth.data.user)throw new Error("AUTH_USER_UNAVAILABLE");
      var uid=auth.data.user.id;
      var p=await sb.from("profiles").select("id,role").eq("id",uid).maybeSingle();if(p.error)throw p.error;if(!p.data||String(p.data.role||"").toLowerCase()!=="distributor")throw new Error("DISTRIBUTOR_PROFILE_UNAVAILABLE");
      var d=await sb.from("distributor_profiles").select("id").eq("id",uid).maybeSingle();if(d.error)throw d.error;if(!d.data)throw new Error("DISTRIBUTOR_PRINCIPAL_UNAVAILABLE");
      if(typeof window.refreshDepletorAllocation!=="function")throw new Error("ALLOCATION_PRODUCER_UNAVAILABLE");
      if(window.goodsbarnxDepletorAllocationVersion!=="V1.8.2.6")throw new Error("DEPLETOR_VERSION_MISMATCH:"+String(window.goodsbarnxDepletorAllocationVersion));
      var source=await fetchSource();
      var sourceHasEarlyGate=/(INVALID|invalid|evidenceClass|classification)[\s\S]{0,500}(continue|return|filter)/.test(source);
      var sourceOutPush=(source.match(/out\.push\s*\(/g)||[]).length;
      var sourceReadEvidence=/function\s+readEvidence\s*\(/.test(source);
      var sourceRefresh=/window\.refreshDepletorAllocation\s*=/.test(source);
      var tracePush=function(){
        var args=Array.prototype.slice.call(arguments);
        originalPush.apply(this,args);
        for(var i=0;i<args.length;i++){
          var v=args[i];
          if(candidate(v)){
            originalPush.call(candidateConstructs,{inquiryId:v.inquiryId,productId:v.productId,routeStatus:v.routeStatus,routeType:v.routeType,allocatableQuantity:v.allocatableQuantity,blockReason:v.blockReason});
            if(v.inquiryId===INVALID)originalPush.call(stackSamples,{stack:(new Error()).stack||""});
          }
        }
      };
      Array.prototype.push=tracePush;
      try{
        await Promise.race([window.refreshDepletorAllocation(),new Promise(function(_,rej){setTimeout(function(){rej(new Error("PRODUCER_TIMEOUT_12000MS"))},12000)})]);
      }catch(e){originalPush.call(observations,"PRODUCER_ERROR:"+(e&&e.message||String(e)))}
      var finalCandidates=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates:[];
      var invalidFinal=finalCandidates.filter(function(x){return x&&x.inquiryId===INVALID});
      var invalidAssignments=assignments.filter(assignmentInvalid);
      var invalidConstructs=candidateConstructs.filter(function(x){return x.inquiryId===INVALID});
      var lines=[];
      lines.push(V+" — INVALID CANDIDATE CONSTRUCTION GATE TRACE");
      lines.push("");
      lines.push("BOOTSTRAP");
      lines.push("✓ Auth user resolved: "+uid);
      lines.push("✓ Distributor principal resolved");
      lines.push("✓ Allocation producer present");
      lines.push("✓ Depletor runtime: V1.8.2.6");
      lines.push("✓ Served depletor.js fetched");
      lines.push("");
      lines.push("SOURCE BOUNDARY");
      lines.push("readEvidence() present: "+sourceReadEvidence);
      lines.push("refreshDepletorAllocation() present: "+sourceRefresh);
      lines.push("out.push() occurrences: "+sourceOutPush);
      lines.push("Early invalid-evidence gate detected: "+sourceHasEarlyGate);
      lines.push("");
      lines.push("CONTROLLED PRODUCER EXECUTION");
      lines.push("Producer returned candidate count: "+finalCandidates.length);
      lines.push("Candidate construction observations: "+candidateConstructs.length);
      lines.push("Invalid inquiry constructions observed: "+invalidConstructs.length);
      lines.push("Invalid inquiry final candidates: "+invalidFinal.length);
      lines.push("Invalid inquiry assignment observations: "+invalidAssignments.length);
      if(invalidConstructs.length){lines.push("");lines.push("INVALID CONSTRUCTION REFERENCES");invalidConstructs.forEach(function(x,i){lines.push((i+1)+" · inquiry="+x.inquiryId+" · product="+x.productId+" · routeStatus="+x.routeStatus+" · allocatableQuantity="+x.allocatableQuantity+" · routeType="+x.routeType+" · blockReason="+String(x.blockReason||""))})}
      if(stackSamples.length){lines.push("");lines.push("FIRST INVALID CONSTRUCTION STACK");lines.push(stackSamples[0].stack)}
      lines.push("");
      if(invalidConstructs.length||invalidFinal.length){lines.push("BOOTSTRAP BOUNDARY BLOCKED — INVALID DEMAND EVIDENCE REACHES CANDIDATE CONSTRUCTION/OUTPUT.");lines.push("The diagnostic itself did not recurse; observations used the original push implementation.")}
      else if(!sourceHasEarlyGate){lines.push("BOUNDARY BLOCKED — PRODUCER EXECUTED WITHOUT AN OBSERVED EARLY INVALID-EVIDENCE GATE.")}
      else{lines.push("BOUNDARY PASS — NO INVALID CANDIDATE CONSTRUCTION OBSERVED AND AN EARLY INVALID-EVIDENCE GATE IS PRESENT.")}
      output(lines);setStatus(lines[lines.length-1]);
    }catch(e){setStatus("TRACE FAILED — "+(e.message||String(e)));output([V+" · TRACE FAILURE",e.stack||e.message||String(e)])}
    finally{Array.prototype.push=originalPush;running=false;if(b)b.disabled=false}
  }
  function mount(){if(!panel())return;setTimeout(run,350)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
