/* GoodsbarnX V1.8.2.6.8.1.1.7 — Invalid Demand Evidence Isolation Boundary
   Read-only diagnostic. Proves classified INVALID inquiries are isolated from the
   downstream allocation/actionability surface exposed by the current allocation runtime.
   No writes, repair, inference, stock mutation, relationship activation, routing mutation,
   allocation mutation, depletion mutation, or order creation.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6.8.1.1.7";
  var EXPECTED={build:VERSION,authVersion:"V1.8.2.6.6.4",allocationVersion:"V1.8.2.6"};
  var started=false,waiting=false,waitStarted=0,MAX_WAIT=15000,RETRY=250;
  var CLASS_ORDER=["VALID","INVALID","MISSING","AMBIGUOUS","UNSUPPORTED"];
  function el(id){return document.getElementById(id)}
  function safe(v){return v==null?"none":String(v)}
  function validId(v){return typeof v==="string"&&v.trim().length>0}
  function text(v){return typeof v==="string"&&v.trim().length>0}
  function numeric(v){if(typeof v==="number")return Number.isFinite(v);if(typeof v==="string"&&v.trim()!=="")return Number.isFinite(Number(v));return false}
  function positiveNumeric(v){return numeric(v)&&Number(v)>0}
  function line(k,n,d){var m=k==="VALID"?"✓ VALID":k==="INVALID"?"✗ INVALID":k==="MISSING"?"⚠ MISSING":k==="AMBIGUOUS"?"⚠ AMBIGUOUS":"? UNSUPPORTED";return m+" — "+n+(d?": "+d:"")}
  function user(){try{return typeof currentUser!=="undefined"?currentUser:null}catch(e){return null}}
  function ctx(){return window.goodsbarnxAuthContext||null}
  function push(a,k,n,d){a.push({kind:k,name:n,detail:d})}
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
  function waitForRuntime(){
    return !!(Array.isArray(window.goodsbarnxAllocationCandidates));
  }
  async function run(){
    if(started||waiting)return;
    var status=el("v18268-isolation-status"),metrics=el("v18268-isolation-metrics"),output=el("v18268-isolation-output");
    if(!status||!metrics||!output)return;
    var marker=document.documentElement.getAttribute("data-goodsbarnx-build")||((document.querySelector('meta[name="goodsbarnx-build"]')||{}).content)||"missing";
    var c=ctx(),u=user(),checks=[];
    push(checks,marker===EXPECTED.build?"VALID":"INVALID","Deployment marker",marker);
    push(checks,window.goodsbarnxAuthContextVersion===EXPECTED.authVersion?"VALID":"INVALID","Auth runtime version",safe(window.goodsbarnxAuthContextVersion));
    push(checks,window.goodsbarnxDepletorAllocationVersion===EXPECTED.allocationVersion?"VALID":"INVALID","Allocation runtime version",safe(window.goodsbarnxDepletorAllocationVersion));
    var authReady=!!c&&c.ready===true&&c.authenticated===true&&validId(c.userId)&&String(c.role||"").toLowerCase()==="distributor";
    var currentReady=!!u&&validId(u.id)&&String(u.role||"").toLowerCase()==="distributor";
    var same=authReady&&currentReady&&String(c.userId)===String(u.id);
    push(checks,authReady?"VALID":"MISSING","Authenticated distributor context",authReady?"ready · "+c.userId:"context unavailable/not distributor");
    push(checks,currentReady?"VALID":"MISSING","Application currentUser distributor principal",currentReady?u.id:"currentUser unavailable/not distributor");
    push(checks,same?"VALID":"INVALID","Context identity continuity",same?"authContext.userId matches currentUser.id":"identity mismatch");
    if(!authReady||!currentReady||!same){
      if(!waitStarted)waitStarted=performance.now();
      status.textContent=VERSION+" WAITING FOR VALID DISTRIBUTOR CONTEXT\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n")+"\n\nNo isolation evaluation executed.";
      metrics.textContent="Isolation boundary waiting for authenticated distributor context.";
      output.textContent="Read-only boundary.\nNo database write executed.\nNo demand evidence isolated.";
      if(performance.now()-waitStarted<MAX_WAIT){waiting=true;setTimeout(function(){waiting=false;run()},RETRY);return;}
      started=true;return;
    }
    if(!waitForRuntime()){
      if(!waitStarted)waitStarted=performance.now();
      status.textContent=VERSION+" WAITING FOR ALLOCATION RUNTIME\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n")+"\n\nWaiting for read-only allocation candidate surface.";
      metrics.textContent="Allocation candidate runtime surface not ready.";
      output.textContent="Read-only boundary.\nNo database write executed.\nNo isolation evaluation executed.";
      if(performance.now()-waitStarted<MAX_WAIT){waiting=true;setTimeout(function(){waiting=false;run()},RETRY);return;}
      started=true;return;
    }
    started=true;
    var id=u.id,t=performance.now(),r=await sb.from("inquiries").select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",id).order("created_at",{ascending:false});
    var qms=Math.round(performance.now()-t),rows=r.data||[],records=checks.slice();
    if(r.error){push(records,"INVALID","Raw inquiry evidence query",r.error.message);finish(records,rows,[],qms,marker);return;}
    push(records,"VALID","Raw inquiry evidence query","read-only query returned without error");
    var outside=rows.filter(function(x){return String(x.distributor_id)!==String(id)}).length;
    push(records,outside?"INVALID":"VALID","Inquiry distributor ownership",outside?outside+" row(s) outside authenticated scope":rows.length+" row(s) scoped to principal");
    var classifications={},invalidIds=[];
    rows.forEach(function(i){var cls=classify(i);classifications[String(i.id)]=cls;if(cls==="INVALID")invalidIds.push(String(i.id));});
    push(records,invalidIds.length>0?"VALID":"INVALID","Invalid demand evidence identified",invalidIds.length+" INVALID inquiry"+(invalidIds.length===1?"":"ies")+" isolated by classification");
    var candidates=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates:[];
    var invalidCandidateRefs=candidates.filter(function(x){return invalidIds.indexOf(String(x.inquiryId))!==-1;});
    push(records,invalidCandidateRefs.length===0?"VALID":"INVALID","INVALID inquiry absent from allocation candidates",invalidCandidateRefs.length===0?"no INVALID inquiry appears in allocation candidate surface":invalidCandidateRefs.length+" INVALID inquiry candidate reference(s) detected");
    var readyInvalid=invalidCandidateRefs.filter(function(x){return String(x.routeStatus||"").toUpperCase()==="READY"||Number(x.allocatableQuantity)>0;});
    push(records,readyInvalid.length===0?"VALID":"INVALID","INVALID inquiry absent from actionable routing",readyInvalid.length===0?"no INVALID inquiry is routing-ready or allocatable":readyInvalid.length+" INVALID inquiry actionability reference(s) detected");
    var allCandidateIds=candidates.map(function(x){return String(x.inquiryId)});
    var duplicateInvalidIds=invalidIds.filter(function(v,n,a){return a.indexOf(v)!==n});
    push(records,duplicateInvalidIds.length===0?"VALID":"INVALID","Invalid evidence isolation identity uniqueness",duplicateInvalidIds.length===0?"each INVALID inquiry id is isolated once":"duplicate INVALID inquiry identity detected");
    var classificationCount=Object.keys(classifications).length===rows.length;
    push(records,classificationCount?"VALID":"INVALID","Inquiry classification coverage",classificationCount?"every queried inquiry has a classification":"classification coverage differs from queried inquiries");
    finish(records,rows,invalidIds,qms,marker,candidates,invalidCandidateRefs,readyInvalid,classifications);
  }
  function finish(records,rows,invalidIds,qms,marker,candidates,invalidCandidateRefs,readyInvalid,classifications){
    var status=el("v18268-isolation-status"),metrics=el("v18268-isolation-metrics"),output=el("v18268-isolation-output");
    var hard=records.some(function(x){return x.kind==="INVALID"})||!invalidIds.length||invalidCandidateRefs.length>0||readyInvalid.length>0;
    status.textContent=(hard?VERSION+" INVALID DEMAND EVIDENCE ISOLATION BLOCKED":VERSION+" INVALID DEMAND EVIDENCE ISOLATION PASSED")+"\n\n"+records.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n");
    metrics.textContent="INQUIRIES "+rows.length+" · INVALID "+invalidIds.length+" · ALLOCATION CANDIDATES "+candidates.length+" · INVALID CANDIDATES "+invalidCandidateRefs.length+" · ACTIONABLE INVALID "+readyInvalid.length;
    output.textContent="INVALID DEMAND EVIDENCE ISOLATION TRACE\n\nPage URL: "+location.href+"\nBuild marker: "+marker+"\nAuth runtime: "+safe(window.goodsbarnxAuthContextVersion)+"\nAllocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion)+"\nQuery time ms: "+qms+"\n\nISOLATION CONTRACT\n• An INVALID inquiry is not actionable demand.\n• An INVALID inquiry must not appear in the allocation candidate surface.\n• An INVALID inquiry must not be routing-ready or allocatable.\n• No conversion, identity inference, repair, or mutation is permitted.\n• Classification and downstream candidate identity are compared by inquiry_id.\n\nCLASSIFICATION\n"+rows.map(function(i,n){return "["+(n+1)+"] inquiry_id="+safe(i.id)+" | classification="+classifications[String(i.id)]}).join("\n")+"\n\nINVALID INQUIRIES\n"+(invalidIds.length?invalidIds.join("\n"):"None")+"\n\nALLOCATION CANDIDATE SURFACE\n"+(candidates.length?candidates.map(function(x,n){return "["+(n+1)+"] inquiry_id="+safe(x.inquiryId)+" | routeStatus="+safe(x.routeStatus)+" | allocatableQuantity="+safe(x.allocatableQuantity)+" | routeType="+safe(x.routeType)}).join("\n"):"No allocation candidates exposed.")+"\n\nINVALID CANDIDATE REFERENCES\n"+(invalidCandidateRefs.length?invalidCandidateRefs.map(function(x){return "inquiry_id="+safe(x.inquiryId)+" | routeStatus="+safe(x.routeStatus)+" | allocatableQuantity="+safe(x.allocatableQuantity)}).join("\n"):"None")+"\n\nNo database write executed.\nNo data repaired.\nNo stock mutation.\nNo relationship activation.\nNo routing/scoring mutation.\nNo depletion mutation.\nNo order created.";
  }
  document.addEventListener("DOMContentLoaded",function(){setTimeout(run,500)});
  window.addEventListener("load",function(){setTimeout(run,500)});
})();
