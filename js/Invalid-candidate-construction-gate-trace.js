/* GoodsbarnX V1.8.2.6.8.1.1.7.3 — Invalid Candidate Construction Gate Trace
   Read-only diagnostic. Resolves the exact candidate-construction gate in the live
   Master Stock Depletor allocation producer. It does not patch producer logic.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6.8.1.1.7.3";
  var EXPECTED={build:VERSION,authVersion:"V1.8.2.6.6.4",allocationVersion:"V1.8.2.6"};
  var started=false,wrapped=false,originalRefresh=null,producerSource="",invocations=[],pushes=[],assignments=[];
  function el(id){return document.getElementById(id)}
  function safe(v){return v==null?"none":String(v)}
  function validId(v){return typeof v==="string"&&v.trim().length>0}
  function text(v){return typeof v==="string"&&v.trim().length>0}
  function numeric(v){if(typeof v==="number")return Number.isFinite(v);if(typeof v==="string"&&v.trim()!=="")return Number.isFinite(Number(v));return false}
  function positiveNumeric(v){return numeric(v)&&Number(v)>0}
  function line(k,n,d){var m=k==="VALID"?"✓ VALID":k==="INVALID"?"✗ INVALID":k==="MISSING"?"⚠ MISSING":"? "+k;return m+" — "+n+(d?": "+d:"")}
  function user(){try{return typeof currentUser!=="undefined"?currentUser:null}catch(e){return null}}
  function ctx(){return window.goodsbarnxAuthContext||null}
  function pushCheck(a,k,n,d){a.push({kind:k,name:n,detail:d})}
  function classify(i){
    var ambiguous=(i.buyer_id!=null&&i.inquirer_id!=null&&String(i.buyer_id)!==String(i.inquirer_id));
    var unsupported=String(i.status||"").trim()!==""&&["open","pending","closed","resolved","completed"].indexOf(String(i.status).trim().toLowerCase())===-1;
    var invalid=!validId(i.id)||(!((i.quantity==null)||String(i.quantity).trim()==="")&&!positiveNumeric(i.quantity));
    var missingQuantity=i.quantity==null||String(i.quantity).trim()==="";
    var missingItem=!text(i.item);
    var missingScale=i.order_scale==null||String(i.order_scale).trim()==="";
    var missingStatus=String(i.status||"").trim()==="";
    var missingBuyer=i.buyer_id==null&&i.inquirer_id==null;
    if(ambiguous)return "AMBIGUOUS";
    if(unsupported)return "UNSUPPORTED";
    if(invalid)return "INVALID";
    if(missingItem||missingQuantity||missingScale||missingStatus||missingBuyer)return "MISSING";
    return "VALID";
  }
  function stack(){try{return String((new Error()).stack||"").split("\n").slice(1,10).join(" | ")}catch(e){return "stack unavailable"}}
  function candidateLike(x){return !!x&&typeof x==="object"&&validId(x.inquiryId)&&Object.prototype.hasOwnProperty.call(x,"productId")&&Object.prototype.hasOwnProperty.call(x,"routeStatus")&&Object.prototype.hasOwnProperty.call(x,"allocatableQuantity")}
  function snap(x){return {inquiryId:safe(x&&x.inquiryId),productId:safe(x&&x.productId),routeStatus:safe(x&&x.routeStatus),allocatableQuantity:safe(x&&x.allocatableQuantity),routeType:safe(x&&x.routeType),opportunityTier:safe(x&&x.opportunityTier),blockReason:safe(x&&x.blockReason)}}
  function installPushTrace(){
    if(window.__gbx1173PushTraceInstalled)return;
    var proto=Array.prototype,orig=proto.push;
    try{
      proto.push=function(){
        for(var i=0;i<arguments.length;i++){
          var x=arguments[i];
          if(candidateLike(x))pushes.push({time:new Date().toISOString(),candidate:snap(x),stack:stack()});
        }
        return orig.apply(this,arguments);
      };
      window.__gbx1173PushTraceInstalled=true;
      window.__gbx1173OriginalArrayPush=orig;
    }catch(e){window.__gbx1173PushTraceInstallError=String(e&&e.message||e)}
  }
  function restorePushTrace(){
    if(!window.__gbx1173PushTraceInstalled)return;
    try{Array.prototype.push=window.__gbx1173OriginalArrayPush;delete window.__gbx1173PushTraceInstalled}catch(e){}
  }
  function installAssignmentTrace(){
    if(window.__gbx1173AssignmentTraceInstalled)return;
    var current;
    try{current=window.goodsbarnxAllocationCandidates}catch(e){current=undefined}
    try{
      Object.defineProperty(window,"goodsbarnxAllocationCandidates",{configurable:true,enumerable:true,get:function(){return current},set:function(v){current=v;var a=Array.isArray(v)?v:[];assignments.push({time:new Date().toISOString(),count:a.length,stack:stack(),invalidCount:a.filter(function(x){return window.__gbx1173InvalidIds&&window.__gbx1173InvalidIds.indexOf(String(x&&x.inquiryId))!==-1}).length});}});
      window.__gbx1173AssignmentTraceInstalled=true;
    }catch(e){window.__gbx1173AssignmentTraceInstallError=String(e&&e.message||e)}
  }
  function wrapProducer(){
    if(wrapped||typeof window.refreshDepletorAllocation!=="function")return false;
    originalRefresh=window.refreshDepletorAllocation;producerSource=String(originalRefresh);window.__gbx1173ProducerSource=producerSource;
    window.refreshDepletorAllocation=async function(){
      var t=performance.now(),before=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates.length:null;
      var call={functionName:"refreshDepletorAllocation",beforeCount:before};
      try{var r=await originalRefresh.apply(this,arguments);call.status="resolved";call.durationMs=Math.round(performance.now()-t);call.returnCount=Array.isArray(r)?r.length:null;call.afterCount=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates.length:null;invocations.push(call);return r}
      catch(e){call.status="rejected";call.durationMs=Math.round(performance.now()-t);call.error=safe(e&&e.message||e);invocations.push(call);throw e}
    };wrapped=true;return true;
  }
  function sourceAround(pattern){
    var idx=producerSource.search(pattern);if(idx<0)return "not found";
    var start=Math.max(0,idx-360),end=Math.min(producerSource.length,idx+700);return producerSource.slice(start,end).replace(/\s+/g," ");
  }
  function finish(checks,rows,invalidIds,marker,qms){
    var status=el("v18268-gate-status"),metrics=el("v18268-gate-metrics"),output=el("v18268-gate-output");
    var invalidPushes=pushes.filter(function(p){return invalidIds.indexOf(String(p.candidate.inquiryId))!==-1});
    var invalidAssignments=assignments.reduce(function(n,a){return n+(a.invalidCount||0)},0);
    var hasConstruction=/out\.push\s*\(\s*\{\s*inquiryId\s*:/.test(producerSource);
    var hasAssignment=/goodsbarnxAllocationCandidates\s*=/.test(producerSource);
    var hasRead=/readEvidence/.test(producerSource);
    var hasClassificationGate=/(classif|classification|INVALID|invalidIds|evidence\.valid)/.test(producerSource);
    var hasAllocGate=/if\s*\(\s*allocatable\s*\)/.test(producerSource);
    pushCheck(checks,hasRead?"VALID":"INVALID","Producer reads inquiry evidence",hasRead?"readEvidence marker present":"readEvidence marker absent");
    pushCheck(checks,hasConstruction?"VALID":"INVALID","Exact candidate construction statement",hasConstruction?"out.push({ inquiryId: ... }) found in live producer source":"candidate construction statement not found");
    pushCheck(checks,hasAssignment?"VALID":"INVALID","Candidate surface assignment statement",hasAssignment?"goodsbarnxAllocationCandidates assignment found":"candidate surface assignment not found");
    pushCheck(checks,hasClassificationGate?"VALID":"INVALID","INVALID evidence construction gate",hasClassificationGate?"classification/invalid gate marker present":"no INVALID classification gate present before candidate construction");
    pushCheck(checks,hasAllocGate?"VALID":"MISSING","Allocatable guard around candidate construction",hasAllocGate?"explicit allocatable guard found":"no explicit allocatable guard found around candidate construction");
    pushCheck(checks,invocations.length>0?"VALID":"MISSING","Controlled producer execution",invocations.length?"refreshDepletorAllocation executed: "+invocations.length:"producer execution not observed");
    pushCheck(checks,invalidPushes.length>0?"INVALID":"VALID","INVALID candidate construction observed",invalidPushes.length?invalidPushes.length+" INVALID candidate object(s) constructed via Array.push":"no INVALID candidate construction observed");
    pushCheck(checks,invalidAssignments>0?"INVALID":"VALID","INVALID candidate reaches candidate surface",invalidAssignments>0?invalidAssignments+" INVALID reference(s) observed at candidate-surface assignment":"no INVALID reference observed");
    var blockedOnly=invalidPushes.every(function(p){return Number(p.candidate.allocatableQuantity)===0&&p.candidate.routeStatus!=="READY"});
    pushCheck(checks,blockedOnly?"VALID":"INVALID","INVALID candidate actionability at construction",blockedOnly?"all observed INVALID candidates are non-actionable":"an INVALID candidate was actionable");
    var pass=hasConstruction&&hasAssignment&&hasRead&&hasClassificationGate===false&&invocations.length>0&&invalidPushes.length>0&&invalidAssignments>0&&blockedOnly;
    if(status)status.textContent=VERSION+" "+(pass?"BLOCKED — LEAK GATE IDENTIFIED":"BLOCKED")+"\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n");
    if(metrics)metrics.textContent="INQUIRIES "+rows.length+" · INVALID "+invalidIds.length+" · PRODUCER INVOCATIONS "+invocations.length+" · CANDIDATE PUSHES "+pushes.length+" · INVALID CONSTRUCTIONS "+invalidPushes.length+" · ASSIGNMENTS "+assignments.length;
    if(output){
      var s=[];s.push("INVALID CANDIDATE CONSTRUCTION GATE TRACE");s.push("");s.push("Page URL: "+location.href);s.push("Build marker: "+marker);s.push("Auth runtime: "+safe(window.goodsbarnxAuthContextVersion));s.push("Allocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion));s.push("Query time ms: "+qms);
      s.push("");s.push("ARCHITECTURE CONTRACT");s.push("• INVALID demand evidence must be stopped before candidate construction.");s.push("• Candidate existence is distinct from route actionability.");s.push("• The diagnostic observes the live producer; it does not alter producer logic.");s.push("• The candidate construction gate is resolved from actual runtime source and controlled execution.");
      s.push("");s.push("PRODUCER");s.push("function=refreshDepletorAllocation");s.push("wrapped="+wrapped);s.push("sourceLength="+producerSource.length);s.push("sourceIdentity="+producerSource.slice(0,240).replace(/\s+/g," "));
      s.push("");s.push("LIVE SOURCE — CANDIDATE CONSTRUCTION REGION");s.push(sourceAround(/out\.push\s*\(\s*\{\s*inquiryId\s*:/));
      s.push("");s.push("GATE RESOLUTION");s.push("classification gate present="+hasClassificationGate);s.push("allocatable guard present="+hasAllocGate);s.push("candidate construction present="+hasConstruction);s.push("candidate surface assignment present="+hasAssignment);s.push("INTERPRETATION: "+(hasConstruction&&!hasClassificationGate?"The live producer constructs candidate objects without an INVALID-evidence exclusion gate. The later allocatable/route fields can block actionability, but they do not prevent candidate creation.":"No definitive missing INVALID gate was established by source inspection."));
      s.push("");s.push("PRODUCER INVOCATIONS");if(!invocations.length)s.push("None observed");else invocations.forEach(function(x,i){s.push("["+(i+1)+"] function="+x.functionName+" | status="+x.status+" | durationMs="+safe(x.durationMs)+" | before="+safe(x.beforeCount)+" | returnCount="+safe(x.returnCount)+" | after="+safe(x.afterCount));});
      s.push("");s.push("CANDIDATE CONSTRUCTIONS");var show=pushes.filter(function(p){return invalidIds.indexOf(String(p.candidate.inquiryId))!==-1});if(!show.length)s.push("No INVALID candidate construction observed");else show.forEach(function(p,i){s.push("["+(i+1)+"] inquiry_id="+p.candidate.inquiryId+" | product_id="+p.candidate.productId+" | routeStatus="+p.candidate.routeStatus+" | allocatableQuantity="+p.candidate.allocatableQuantity+" | routeType="+p.candidate.routeType);s.push("    stack="+p.stack);});
      s.push("");s.push("CANDIDATE-SURFACE ASSIGNMENTS");if(!assignments.length)s.push("None observed");else assignments.forEach(function(a,i){s.push("["+(i+1)+"] time="+a.time+" | count="+a.count+" | INVALID refs="+a.invalidCount);s.push("    stack="+a.stack);});
      s.push("");s.push("TRANSITION CONCLUSION");s.push(hasConstruction&&!hasClassificationGate&&invalidPushes.length?"The exact leak is at candidate construction: the live producer creates candidate objects for the INVALID inquiry before any INVALID-evidence exclusion gate. The existing routeStatus/allocatableQuantity block is downstream of candidate creation.":"The exact construction gate was not conclusively resolved.");
      s.push("");s.push("No database write executed.");s.push("No data repaired.");s.push("No stock mutation.");s.push("No relationship activation.");s.push("No routing/scoring mutation.");s.push("No allocation producer logic modified.");s.push("Array.push instrumentation restored after controlled execution.");
      output.textContent=s.join("\n");
    }
  }
  async function run(){
    if(started)return;var status=el("v18268-gate-status"),metrics=el("v18268-gate-metrics"),output=el("v18268-gate-output");if(!status||!metrics||!output)return;started=true;
    installAssignmentTrace();installPushTrace();wrapProducer();
    var marker=document.documentElement.getAttribute("data-goodsbarnx-build")||((document.querySelector('meta[name="goodsbarnx-build"]')||{}).content)||"missing",c=ctx(),u=user(),checks=[];
    pushCheck(checks,marker===EXPECTED.build?"VALID":"INVALID","Deployment marker",marker);pushCheck(checks,window.goodsbarnxAuthContextVersion===EXPECTED.authVersion?"VALID":"INVALID","Auth runtime version",safe(window.goodsbarnxAuthContextVersion));pushCheck(checks,window.goodsbarnxDepletorAllocationVersion===EXPECTED.allocationVersion?"VALID":"INVALID","Allocation runtime version",safe(window.goodsbarnxDepletorAllocationVersion));
    var authReady=!!c&&c.ready===true&&c.authenticated===true&&validId(c.userId)&&String(c.role||"").toLowerCase()==="distributor",currentReady=!!u&&validId(u.id)&&String(u.role||"").toLowerCase()==="distributor",same=authReady&&currentReady&&String(c.userId)===String(u.id);
    pushCheck(checks,authReady?"VALID":"MISSING","Authenticated distributor context",authReady?"ready · "+c.userId:"context unavailable/not distributor");pushCheck(checks,currentReady?"VALID":"MISSING","Application currentUser distributor principal",currentReady?u.id:"currentUser unavailable/not distributor");pushCheck(checks,same?"VALID":"INVALID","Context identity continuity",same?"authContext.userId matches currentUser.id":"identity mismatch");
    if(!authReady||!currentReady||!same||typeof window.refreshDepletorAllocation!=="function"){status.textContent=VERSION+" WAITING FOR RUNTIME";restorePushTrace();return;}
    var id=u.id,t=performance.now(),r=await sb.from("inquiries").select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",id).order("created_at",{ascending:false}),qms=Math.round(performance.now()-t),rows=r.data||[];
    if(r.error){pushCheck(checks,"INVALID","Raw inquiry evidence query",r.error.message);restorePushTrace();finish(checks,rows,[],marker,qms);return;}
    pushCheck(checks,"VALID","Raw inquiry evidence query","read-only query returned without error");var outside=rows.filter(function(x){return String(x.distributor_id)!==String(id)}).length;pushCheck(checks,outside?"INVALID":"VALID","Inquiry distributor ownership",outside?outside+" row(s) outside authenticated scope":rows.length+" row(s) scoped to principal");
    var invalidIds=rows.filter(function(i){return classify(i)==="INVALID"}).map(function(i){return String(i.id)});window.__gbx1173InvalidIds=invalidIds;pushCheck(checks,invalidIds.length===1?"VALID":"INVALID","INVALID evidence cardinality",invalidIds.length+" INVALID inquiry"+(invalidIds.length===1?"":"ies")+" identified");
    try{await window.refreshDepletorAllocation()}catch(e){pushCheck(checks,"INVALID","Controlled producer execution","producer rejected: "+safe(e&&e.message||e))}
    restorePushTrace();finish(checks,rows,invalidIds,marker,qms);
  }
  document.addEventListener("DOMContentLoaded",function(){setTimeout(run,150)});
})();
