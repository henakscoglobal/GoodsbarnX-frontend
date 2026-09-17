/* GoodsbarnX V1.8.2.6.8.1.1.7.1 — Invalid Demand Evidence Candidate Leakage Trace
   Read-only diagnostic. Traces the runtime transition by which an INVALID inquiry
   reaches the downstream allocation candidate surface.
   No writes, repair, inference, stock mutation, relationship activation, routing mutation,
   allocation mutation, depletion mutation, or order creation.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6.8.1.1.7.1";
  var TARGET="V1.8.2.6.8.1.1.7";
  var EXPECTED={build:VERSION,authVersion:"V1.8.2.6.6.4",allocationVersion:"V1.8.2.6"};
  var started=false,waiting=false,waitStarted=0,MAX_WAIT=15000,RETRY=250;
  var assignmentLog=[];
  var originalRefresh=null;
  var originalRefreshSource="";
  var refreshWrapped=false;

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
  function stack(){try{return String((new Error()).stack||"").split("\n").slice(1,8).join(" | ")}catch(e){return "stack unavailable"}}
  function installAssignmentTrace(){
    if(Object.prototype.hasOwnProperty.call(window,"__gbx1171AssignmentTraceInstalled"))return;
    var current;
    try{current=window.goodsbarnxAllocationCandidates}catch(e){current=undefined}
    try{
      Object.defineProperty(window,"goodsbarnxAllocationCandidates",{
        configurable:true,
        enumerable:true,
        get:function(){return current},
        set:function(v){
          current=v;
          var arr=Array.isArray(v)?v:[];
          assignmentLog.push({time:new Date().toISOString(),count:arr.length,invalidRefs:0,stack:stack(),snapshot:arr.map(function(x){return {inquiryId:x&&x.inquiryId,routeStatus:x&&x.routeStatus,allocatableQuantity:x&&x.allocatableQuantity,routeType:x&&x.routeType}})});
        }
      });
      window.__gbx1171AssignmentTraceInstalled=true;
    }catch(e){window.__gbx1171AssignmentTraceInstallError=String(e&&e.message||e)}
  }
  function wrapRefresh(){
    if(refreshWrapped||typeof window.refreshDepletorAllocation!=="function")return;
    originalRefresh=window.refreshDepletorAllocation;
    originalRefreshSource=String(originalRefresh);
    window.refreshDepletorAllocation=async function(){
      var before=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates.length:null;
      var startedAt=performance.now();
      var result=await originalRefresh.apply(this,arguments);
      window.__gbx1171LastRefreshTrace={durationMs:Math.round(performance.now()-startedAt),beforeCount:before,afterCount:Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates.length:null,returnCount:Array.isArray(result)?result.length:null,stack:stack()};
      return result;
    };
    refreshWrapped=true;
  }
  function waitForRuntime(){return !!(Array.isArray(window.goodsbarnxAllocationCandidates)||typeof window.refreshDepletorAllocation==="function")}

  async function run(){
    if(started||waiting)return;
    var status=el("v18268-isolation-status"),metrics=el("v18268-isolation-metrics"),output=el("v18268-isolation-output");
    if(!status||!metrics||!output)return;
    installAssignmentTrace();
    wrapRefresh();
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
    if(!authReady||!currentReady||!same||!waitForRuntime()){
      if(!waitStarted)waitStarted=performance.now();
      status.textContent=VERSION+" WAITING FOR RUNTIME TRACE\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n")+"\n\nWaiting for allocation producer execution.";
      metrics.textContent="Candidate leakage trace waiting for authenticated distributor and allocation runtime.";
      output.textContent="Read-only boundary.\nNo database write executed.\nNo leakage evaluation executed.";
      if(performance.now()-waitStarted<MAX_WAIT){waiting=true;setTimeout(function(){waiting=false;run()},RETRY);return;}
      started=true;return;
    }
    started=true;
    var id=u.id,t=performance.now(),r=await sb.from("inquiries").select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",id).order("created_at",{ascending:false});
    var qms=Math.round(performance.now()-t),rows=r.data||[],records=checks.slice();
    if(r.error){push(records,"INVALID","Raw inquiry evidence query",r.error.message);finish(records,rows,[],qms,marker,[],[],[],{},null);return;}
    push(records,"VALID","Raw inquiry evidence query","read-only query returned without error");
    var outside=rows.filter(function(x){return String(x.distributor_id)!==String(id)}).length;
    push(records,outside?"INVALID":"VALID","Inquiry distributor ownership",outside?outside+" row(s) outside authenticated scope":rows.length+" row(s) scoped to principal");
    var classifications={},invalidIds=[];
    rows.forEach(function(i){var cls=classify(i);classifications[String(i.id)]=cls;if(cls==="INVALID")invalidIds.push(String(i.id));});
    push(records,invalidIds.length===1?"VALID":invalidIds.length>1?"INVALID":"INVALID","INVALID evidence cardinality",invalidIds.length+" INVALID inquiry"+(invalidIds.length===1?"":"ies")+" identified");
    if(invalidIds.length)window.__gbx1171InvalidInquiryId=invalidIds[0];
    wrapRefresh();
    var candidates=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates:[];
    var invalidCandidateRefs=candidates.filter(function(x){return invalidIds.indexOf(String(x.inquiryId))!==-1;});
    var traceAssignments=assignmentLog.map(function(a){var refs=(a.snapshot||[]).filter(function(x){return invalidIds.indexOf(String(x.inquiryId))!==-1});return {time:a.time,count:a.count,invalidRefs:refs.length,stack:a.stack,snapshot:a.snapshot};});
    var runtimeProducer=traceAssignments.length>0;
    push(records,runtimeProducer?"VALID":"MISSING","Candidate surface assignment trace",runtimeProducer?traceAssignments.length+" runtime candidate-surface assignment(s) observed":"no runtime candidate-surface assignment observed yet");
    var source=originalRefreshSource||"";
    var sourceMarkers=[
      ["producer reads inquiries","readEvidence"],
      ["candidate construction","out.push"],
      ["candidate surface assignment","goodsbarnxAllocationCandidates=state.candidates"]
    ];
    sourceMarkers.forEach(function(m){push(records,source.indexOf(m[1])!==-1?"VALID":"INVALID","Allocation producer source marker · "+m[0],source.indexOf(m[1])!==-1?"marker present in runtime function source":"marker not present")});
    var firstLeak=traceAssignments.find(function(x){return x.invalidRefs>0})||null;
    push(records,invalidCandidateRefs.length>0?"VALID":"VALID","INVALID candidate presence traced",invalidCandidateRefs.length>0?invalidCandidateRefs.length+" INVALID candidate reference(s) observed; leakage is reproduced": "no INVALID candidate reference observed");
    push(records,firstLeak?"INVALID":"VALID","INVALID inquiry candidate-surface transition",firstLeak?"INVALID inquiry crossed into candidate surface during runtime assignment":"no INVALID inquiry crossing observed");
    var readyInvalid=invalidCandidateRefs.filter(function(x){return String(x.routeStatus||"").toUpperCase()==="READY"||Number(x.allocatableQuantity)>0;});
    push(records,readyInvalid.length===0?"VALID":"INVALID","INVALID inquiry actionability state",readyInvalid.length===0?"leaked candidates remain non-actionable":readyInvalid.length+" INVALID candidate(s) are actionable");
    finish(records,rows,invalidIds,qms,marker,candidates,invalidCandidateRefs,readyInvalid,classifications,traceAssignments);
  }
  function finish(records,rows,invalidIds,qms,marker,candidates,invalidCandidateRefs,readyInvalid,classifications,traceAssignments){
    var status=el("v18268-isolation-status"),metrics=el("v18268-isolation-metrics"),output=el("v18268-isolation-output");
    var hard=records.some(function(x){return x.kind==="INVALID"})||!invalidIds.length||!traceAssignments.length;
    status.textContent=(hard?VERSION+" INVALID DEMAND EVIDENCE LEAKAGE TRACE BLOCKED":VERSION+" INVALID DEMAND EVIDENCE LEAKAGE TRACE PASSED")+"\n\n"+records.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n");
    metrics.textContent="INQUIRIES "+rows.length+" · INVALID "+invalidIds.length+" · CANDIDATES "+candidates.length+" · INVALID CANDIDATES "+invalidCandidateRefs.length+" · ACTIONABLE INVALID "+readyInvalid.length+" · ASSIGNMENTS "+traceAssignments.length;
    output.textContent="INVALID DEMAND EVIDENCE CANDIDATE LEAKAGE TRACE\n\nPage URL: "+location.href+"\nBuild marker: "+marker+"\nAuth runtime: "+safe(window.goodsbarnxAuthContextVersion)+"\nAllocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion)+"\nQuery time ms: "+qms+"\n\nTRACE CONTRACT\n• Locate the exact runtime transition by which an INVALID inquiry reaches the candidate surface.\n• Runtime assignment is captured without changing the allocation producer.\n• INVALID candidate presence is reproduced, not repaired.\n• Actionability is measured separately from candidate existence.\n• No conversion, identity inference, repair, or mutation is permitted.\n\nCLASSIFICATION\n"+rows.map(function(i,n){return "["+(n+1)+"] inquiry_id="+safe(i.id)+" | classification="+classifications[String(i.id)]}).join("\n")+"\n\nRUNTIME CANDIDATE-SURFACE ASSIGNMENTS\n"+(traceAssignments.length?traceAssignments.map(function(x,n){return "["+(n+1)+"] time="+safe(x.time)+" | candidate_count="+x.count+" | invalid_refs_at_assignment="+x.invalidRefs+" | stack="+x.stack}).join("\n") : "None")+"\n\nLAST REFRESH TRACE\n"+(window.__gbx1171LastRefreshTrace?JSON.stringify(window.__gbx1171LastRefreshTrace,null,2):"Not captured")+"\n\nINVALID CANDIDATE REFERENCES\n"+(invalidCandidateRefs.length?invalidCandidateRefs.map(function(x,n){return "["+(n+1)+"] inquiry_id="+safe(x.inquiryId)+" | routeStatus="+safe(x.routeStatus)+" | allocatableQuantity="+safe(x.allocatableQuantity)+" | routeType="+safe(x.routeType)}).join("\n"):"None")+"\n\nTRANSITION CONCLUSION\n"+(invalidCandidateRefs.length?"The INVALID inquiry is reproduced on the downstream candidate surface. Its route state remains non-actionable, but candidate existence itself is the leakage under investigation.":"No INVALID candidate leakage reproduced in this runtime." )+"\n\nNo database write executed.\nNo data repaired.\nNo stock mutation.\nNo relationship activation.\nNo routing/scoring mutation.\nNo depletion mutation.\nNo order created.";
  }
  installAssignmentTrace();
  wrapRefresh();
  document.addEventListener("DOMContentLoaded",function(){setTimeout(run,500)});
  window.addEventListener("load",function(){setTimeout(run,500)});
})();
