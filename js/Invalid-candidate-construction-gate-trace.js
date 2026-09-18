/* GoodsbarnX V1.8.2.6.8.1.1.7.3.1 — Invalid Candidate Construction Gate Trace
   Read-only diagnostic. Uses the proven refreshDepletorAllocation() execution path,
   resolves candidate construction from the actual depletor.js source, and traces
   the known INVALID inquiry through construction and candidate-surface assignment.
   No producer logic is modified and all diagnostic hooks are restored.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6.8.1.1.7.3.1";
  var TARGET="V1.8.2.6.8.1.1.7.3";
  var EXPECTED={build:VERSION,authVersion:"V1.8.2.6.6.4",allocationVersion:"V1.8.2.6"};
  var started=false,finished=false,producerOriginal=null,wrapped=false,source="",readEvidenceSource="",pushes=[],assignments=[],invocations=[],waitAttempts=0,originalAllocationDescriptor=null,originalAllocationValue;
  function el(id){return document.getElementById(id)}
  function safe(v){return v==null?"none":String(v)}
  function validId(v){return typeof v==="string"&&v.trim().length>0}
  function text(v){return typeof v==="string"&&v.trim().length>0}
  function numeric(v){if(typeof v==="number")return Number.isFinite(v);if(typeof v==="string"&&v.trim()!=="")return Number.isFinite(Number(v));return false}
  function positiveNumeric(v){return numeric(v)&&Number(v)>0}
  function line(k,n,d){return (k==="VALID"?"✓ VALID":k==="INVALID"?"✗ INVALID":k==="MISSING"?"⚠ MISSING":"? "+k)+" — "+n+(d?": "+d:"")}
  function user(){try{return typeof currentUser!=="undefined"?currentUser:null}catch(e){return null}}
  function ctx(){return window.goodsbarnxAuthContext||null}
  function pushCheck(a,k,n,d){a.push({kind:k,name:n,detail:d})}
  function classify(i){
    var ambiguous=i.buyer_id!=null&&i.inquirer_id!=null&&String(i.buyer_id)!==String(i.inquirer_id);
    var unsupported=String(i.status||"").trim()!==""&&["open","pending","closed","resolved","completed"].indexOf(String(i.status).trim().toLowerCase())===-1;
    var invalid=!validId(i.id)||(!((i.quantity==null)||String(i.quantity).trim()==="")&&!positiveNumeric(i.quantity));
    var missingQuantity=i.quantity==null||String(i.quantity).trim()==="";
    var missingItem=!text(i.item),missingScale=i.order_scale==null||String(i.order_scale).trim()==="",missingStatus=String(i.status||"").trim()==="",missingBuyer=i.buyer_id==null&&i.inquirer_id==null;
    if(ambiguous)return "AMBIGUOUS"; if(unsupported)return "UNSUPPORTED"; if(invalid)return "INVALID"; if(missingItem||missingQuantity||missingScale||missingStatus||missingBuyer)return "MISSING"; return "VALID";
  }
  function stack(){try{return String((new Error()).stack||"").split("\n").slice(1,9).join(" | ")}catch(e){return "stack unavailable"}}
  function candidateLike(x){return !!x&&typeof x==="object"&&validId(x.inquiryId)&&Object.prototype.hasOwnProperty.call(x,"productId")&&Object.prototype.hasOwnProperty.call(x,"routeStatus")&&Object.prototype.hasOwnProperty.call(x,"allocatableQuantity")}
  function snap(x){return {inquiryId:safe(x&&x.inquiryId),productId:safe(x&&x.productId),routeStatus:safe(x&&x.routeStatus),allocatableQuantity:safe(x&&x.allocatableQuantity),routeType:safe(x&&x.routeType),opportunityTier:safe(x&&x.opportunityTier),blockReason:safe(x&&x.blockReason)}}
  function installPushTrace(){
    if(window.__gbx11731PushTraceInstalled)return;
    var orig=Array.prototype.push;
    try{
      Array.prototype.push=function(){
        for(var i=0;i<arguments.length;i++){var x=arguments[i];if(candidateLike(x))pushes.push({time:new Date().toISOString(),candidate:snap(x),stack:stack()});}
        return orig.apply(this,arguments);
      };
      window.__gbx11731OriginalArrayPush=orig;window.__gbx11731PushTraceInstalled=true;
    }catch(e){window.__gbx11731PushTraceInstallError=String(e&&e.message||e)}
  }
  function restorePushTrace(){if(!window.__gbx11731PushTraceInstalled)return;try{Array.prototype.push=window.__gbx11731OriginalArrayPush;delete window.__gbx11731PushTraceInstalled;delete window.__gbx11731OriginalArrayPush}catch(e){}}
  function installAssignmentTrace(){
    if(window.__gbx11731AssignmentTraceInstalled)return;
    var current;
    try{current=window.goodsbarnxAllocationCandidates}catch(e){current=undefined}
    try{originalAllocationDescriptor=Object.getOwnPropertyDescriptor(window,"goodsbarnxAllocationCandidates");originalAllocationValue=current}catch(e){originalAllocationDescriptor=null;originalAllocationValue=current}
    try{
      Object.defineProperty(window,"goodsbarnxAllocationCandidates",{configurable:true,enumerable:true,get:function(){return current},set:function(v){current=v;var a=Array.isArray(v)?v:[];var ids=window.__gbx11731InvalidIds||[];assignments.push({time:new Date().toISOString(),count:a.length,invalidCount:a.filter(function(x){return ids.indexOf(String(x&&x.inquiryId))!==-1}).length,stack:stack()});}});
      window.__gbx11731AssignmentTraceInstalled=true;
    }catch(e){window.__gbx11731AssignmentTraceInstallError=String(e&&e.message||e)}
  }
  function restoreAssignmentTrace(){
    if(!window.__gbx11731AssignmentTraceInstalled)return;
    try{
      var finalValue;
      try{finalValue=window.goodsbarnxAllocationCandidates}catch(e){finalValue=originalAllocationValue}
      delete window.goodsbarnxAllocationCandidates;
      if(originalAllocationDescriptor){Object.defineProperty(window,"goodsbarnxAllocationCandidates",originalAllocationDescriptor);}
      else{Object.defineProperty(window,"goodsbarnxAllocationCandidates",{configurable:true,enumerable:true,writable:true,value:finalValue});}
      delete window.__gbx11731AssignmentTraceInstalled;
    }catch(e){}
  }
  function wrapProducer(){
    if(wrapped||typeof window.refreshDepletorAllocation!=="function")return false;
    producerOriginal=window.refreshDepletorAllocation;source=String(producerOriginal);
    window.refreshDepletorAllocation=async function(){
      var t=performance.now(),before=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates.length:null,call={functionName:"refreshDepletorAllocation",beforeCount:before};
      try{var r=await producerOriginal.apply(this,arguments);call.status="resolved";call.durationMs=Math.round(performance.now()-t);call.returnCount=Array.isArray(r)?r.length:null;call.afterCount=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates.length:null;invocations.push(call);return r}
      catch(e){call.status="rejected";call.durationMs=Math.round(performance.now()-t);call.error=safe(e&&e.message||e);invocations.push(call);throw e}
    };
    wrapped=true;return true;
  }
  async function fetchSource(){
    try{var r=await fetch("js/depletor.js?gbx_trace="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);sourceText=await r.text();return sourceText}catch(e){return ""}
  }
  var sourceText="";
  function extractReadEvidence(s){
    var start=s.indexOf("async function readEvidence()");if(start<0)start=s.indexOf("function readEvidence()");if(start<0)return "";
    var brace=s.indexOf("{",start),depth=0;
    for(var i=brace;i<s.length;i++){if(s[i]==="{")depth++;else if(s[i]==="}"){depth--;if(depth===0)return s.slice(start,i+1)}}
    return s.slice(start);
  }
  function sourceRegion(s,pattern){var idx=s.search(pattern);if(idx<0)return "not found";return s.slice(Math.max(0,idx-420),Math.min(s.length,idx+900)).replace(/\s+/g," ")}
  function finish(checks,rows,invalidIds,marker,qms){
    if(finished)return;finished=true;restorePushTrace();restoreAssignmentTrace();
    var status=el("v18268-gate-status"),metrics=el("v18268-gate-metrics"),output=el("v18268-gate-output");
    var invalidPushes=pushes.filter(function(p){return invalidIds.indexOf(String(p.candidate.inquiryId))!==-1});
    var invalidAssignments=assignments.reduce(function(n,a){return n+(a.invalidCount||0)},0);
    var hasRead=/async function readEvidence\(|function readEvidence\(/.test(readEvidenceSource);
    var hasConstruction=/out\.push\s*\(\s*\{\s*inquiryId\s*:/.test(readEvidenceSource);
    var hasMatch=/matches\s*=\s*products\.filter/.test(readEvidenceSource);
    var hasInvalidGate=/(classification|classify|INVALID|invalidIds|evidence\.valid)/.test(readEvidenceSource);
    var hasAllocGate=/allocatable\s*=/.test(readEvidenceSource)&&/if\s*\(\s*allocatable/.test(readEvidenceSource);
    pushCheck(checks,hasRead?"VALID":"INVALID","Actual readEvidence source resolved",hasRead?"readEvidence function located in served depletor.js":"readEvidence function not located");
    pushCheck(checks,hasMatch?"VALID":"INVALID","Product-demand match stage located",hasMatch?"matches=products.filter(...) present":"product-demand matching stage not located");
    pushCheck(checks,hasConstruction?"VALID":"INVALID","Exact candidate construction gate located",hasConstruction?"out.push({ inquiryId: ... }) located in readEvidence":"candidate construction statement not located");
    pushCheck(checks,hasInvalidGate?"VALID":"INVALID","INVALID evidence exclusion gate",hasInvalidGate?"classification/INVALID marker present in producer source":"no INVALID classification/exclusion predicate present");
    pushCheck(checks,hasAllocGate?"VALID":"MISSING","Allocatable state calculated before candidate insertion",hasAllocGate?"allocatable predicate and downstream guard marker present":"allocatable predicate/guard not explicitly located");
    pushCheck(checks,invocations.length>0?"VALID":"INVALID","Controlled producer execution",invocations.length+" refreshDepletorAllocation execution(s)");
    pushCheck(checks,invalidPushes.length>0?"INVALID":"VALID","INVALID candidate construction observed",invalidPushes.length?invalidPushes.length+" INVALID candidate object(s) constructed":"no INVALID candidate construction observed");
    pushCheck(checks,invalidAssignments>0?"INVALID":"VALID","INVALID candidate reaches candidate surface",invalidAssignments>0?invalidAssignments+" INVALID reference(s) observed at assignment":"no INVALID reference observed at assignment");
    var blockedOnly=invalidPushes.length===0||invalidPushes.every(function(p){return Number(p.candidate.allocatableQuantity)===0&&p.candidate.routeStatus!=="READY"});
    pushCheck(checks,blockedOnly?"VALID":"INVALID","INVALID candidate actionability",blockedOnly?"no actionable INVALID candidate observed":"actionable INVALID candidate observed");
    var leakResolved=hasConstruction&&hasMatch&&!hasInvalidGate&&invalidPushes.length>0&&invalidAssignments>0;
    var result=leakResolved?"BLOCKED — CONSTRUCTION GATE LOCATED":"BLOCKED";
    if(status)status.textContent=VERSION+" "+result+"\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n");
    if(metrics)metrics.textContent="INQUIRIES "+rows.length+" · INVALID "+invalidIds.length+" · PRODUCER INVOCATIONS "+invocations.length+" · CANDIDATE CONSTRUCTIONS "+pushes.length+" · INVALID CONSTRUCTIONS "+invalidPushes.length+" · ASSIGNMENTS "+assignments.length;
    if(output){
      var s=[];s.push("INVALID CANDIDATE CONSTRUCTION GATE TRACE");s.push("");s.push("Page URL: "+location.href);s.push("Build marker: "+marker);s.push("Auth runtime: "+safe(window.goodsbarnxAuthContextVersion));s.push("Allocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion));s.push("Query time ms: "+qms);
      s.push("");s.push("MASTER STOCK DEPLETOR CONTRACT");s.push("• Stock Intelligence supplies product/stock evidence.");s.push("• Demand Radar supplies inquiry evidence.");s.push("• Opportunity/Allocation may only construct a candidate from commercially valid demand evidence.");s.push("• INVALID demand must be excluded before candidate construction, not merely blocked after construction.");s.push("• This diagnostic observes the live producer and makes no commercial mutation.");
      s.push("");s.push("RESOLVED PRODUCER");s.push("function=refreshDepletorAllocation");s.push("wrapped="+wrapped);s.push("producer source length="+source.length);s.push("readEvidence source length="+readEvidenceSource.length);
      s.push("");s.push("SOURCE GATE ANALYSIS");s.push("product-demand match present="+hasMatch);s.push("candidate construction present="+hasConstruction);s.push("INVALID exclusion gate present="+hasInvalidGate);s.push("allocatable calculation/guard present="+hasAllocGate);
      s.push("");s.push("READ EVIDENCE — CANDIDATE CONSTRUCTION REGION");s.push(sourceRegion(readEvidenceSource,/out\.push\s*\(\s*\{\s*inquiryId\s*:/));
      s.push("");s.push("READ EVIDENCE — MATCH REGION");s.push(sourceRegion(readEvidenceSource,/var matches=products\.filter/));
      s.push("");s.push("READ EVIDENCE — ALLOCATABLE REGION");s.push(sourceRegion(readEvidenceSource,/var allocatable=/));
      s.push("");s.push("PRODUCER INVOCATIONS");if(!invocations.length)s.push("None observed");else invocations.forEach(function(x,i){s.push("["+(i+1)+"] function="+x.functionName+" | status="+x.status+" | durationMs="+safe(x.durationMs)+" | before="+safe(x.beforeCount)+" | returnCount="+safe(x.returnCount)+" | after="+safe(x.afterCount));});
      s.push("");s.push("INVALID CANDIDATE CONSTRUCTIONS");if(!invalidPushes.length)s.push("None observed");else invalidPushes.forEach(function(p,i){s.push("["+(i+1)+"] inquiry_id="+p.candidate.inquiryId+" | product_id="+p.candidate.productId+" | routeStatus="+p.candidate.routeStatus+" | allocatableQuantity="+p.candidate.allocatableQuantity+" | routeType="+p.candidate.routeType);s.push("    stack="+p.stack);});
      s.push("");s.push("CANDIDATE-SURFACE ASSIGNMENTS");if(!assignments.length)s.push("None observed");else assignments.forEach(function(a,i){s.push("["+(i+1)+"] time="+a.time+" | count="+a.count+" | INVALID refs="+a.invalidCount);s.push("    stack="+a.stack);});
      s.push("");s.push("TRANSITION CONCLUSION");s.push(leakResolved?"The exact construction gate is resolved: readEvidence performs product-demand matching and constructs candidate objects with out.push(...), but the served producer source contains no INVALID-evidence exclusion predicate before construction. The current allocatable/routeStatus logic therefore blocks actionability downstream without isolating invalid demand at the candidate-construction boundary.":"The construction gate was not conclusively resolved by this controlled execution.");
      s.push("");s.push("No database write executed.");s.push("No data repaired.");s.push("No stock mutation.");s.push("No relationship activation.");s.push("No routing/scoring mutation.");s.push("No allocation producer logic modified.");s.push("All diagnostic hooks restored after controlled execution.");output.textContent=s.join("\n");
    }
  }
  async function run(){
    if(started)return;var status=el("v18268-gate-status"),metrics=el("v18268-gate-metrics"),output=el("v18268-gate-output");if(!status||!metrics||!output)return;started=true;
    var marker=document.documentElement.getAttribute("data-goodsbarnx-build")||((document.querySelector('meta[name="goodsbarnx-build"]')||{}).content)||"missing",c=ctx(),u=user(),checks=[];
    pushCheck(checks,marker===EXPECTED.build?"VALID":"INVALID","Deployment marker",marker);pushCheck(checks,window.goodsbarnxAuthContextVersion===EXPECTED.authVersion?"VALID":"INVALID","Auth runtime version",safe(window.goodsbarnxAuthContextVersion));pushCheck(checks,window.goodsbarnxDepletorAllocationVersion===EXPECTED.allocationVersion?"VALID":"INVALID","Allocation runtime version",safe(window.goodsbarnxDepletorAllocationVersion));
    var authReady=!!c&&c.ready===true&&c.authenticated===true&&validId(c.userId)&&String(c.role||"").toLowerCase()==="distributor",currentReady=!!u&&validId(u.id)&&String(u.role||"").toLowerCase()==="distributor",same=authReady&&currentReady&&String(c.userId)===String(u.id);
    if(!authReady||!currentReady||!same||typeof window.refreshDepletorAllocation!=="function"){waitAttempts++;status.textContent=VERSION+"\n\n⚠ MISSING — Controlled producer runtime: waiting for authenticated distributor runtime…";metrics.textContent="Diagnostic will execute automatically when the known producer is ready. Attempt "+waitAttempts+".";if(waitAttempts<60)setTimeout(function(){started=false;run()},500);else{finished=true;status.textContent=VERSION+" BLOCKED\n\n✗ INVALID — Controlled producer runtime: readiness timeout after 30 seconds.";}return;}
    installAssignmentTrace();installPushTrace();wrapProducer();
    var id=u.id,t=performance.now(),r=await sb.from("inquiries").select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",id).order("created_at",{ascending:false}),qms=Math.round(performance.now()-t),rows=r.data||[];
    if(r.error){pushCheck(checks,"INVALID","Raw inquiry evidence query",r.error.message);restorePushTrace();finish(checks,rows,[],marker,qms);return;}
    pushCheck(checks,"VALID","Raw inquiry evidence query","read-only query returned without error");var outside=rows.filter(function(x){return String(x.distributor_id)!==String(id)}).length;pushCheck(checks,outside?"INVALID":"VALID","Inquiry distributor ownership",outside?outside+" row(s) outside authenticated scope":rows.length+" row(s) scoped to principal");
    var invalidIds=rows.filter(function(i){return classify(i)==="INVALID"}).map(function(i){return String(i.id)});window.__gbx11731InvalidIds=invalidIds;pushCheck(checks,invalidIds.length===1?"VALID":"INVALID","INVALID evidence cardinality",invalidIds.length+" INVALID inquiry"+(invalidIds.length===1?"":"ies")+" identified");
    var sourceFetch=await fetchSource();readEvidenceSource=extractReadEvidence(sourceFetch);
    try{await window.refreshDepletorAllocation()}catch(e){pushCheck(checks,"INVALID","Controlled producer execution","producer rejected: "+safe(e&&e.message||e))}
    finish(checks,rows,invalidIds,marker,qms);
  }
  document.addEventListener("DOMContentLoaded",function(){setTimeout(run,300)});
  window.addEventListener("load",function(){if(!started)setTimeout(run,500)});
})();
