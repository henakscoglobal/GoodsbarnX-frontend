/* GoodsbarnX V1.8.2.6.8.1.1.7.2 — Allocation Candidate Producer Resolution Trace
   Read-only diagnostic. Resolves the actual runtime producer path for allocation candidates.
   It instruments only the diagnostic boundary and invokes the existing allocation refresh
   function after instrumentation. No producer logic is modified and no data is written.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6.8.1.1.7.2";
  var TARGET="V1.8.2.6.8.1.1.7";
  var EXPECTED={build:VERSION,authVersion:"V1.8.2.6.6.4",allocationVersion:"V1.8.2.6"};
  var started=false,waiting=false,waitStarted=0,MAX_WAIT=15000,RETRY=250;
  var assignments=[],invocations=[];
  var wrapped=false,originalRefresh=null,producerSource="";

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
  function stack(){try{return String((new Error()).stack||"").split("\n").slice(1,9).join(" | ")}catch(e){return "stack unavailable"}}
  function snapshot(v,invalidIds){
    var arr=Array.isArray(v)?v:[];
    return arr.map(function(x){return {inquiryId:x&&x.inquiryId,productId:x&&x.productId,routeStatus:x&&x.routeStatus,allocatableQuantity:x&&x.allocatableQuantity,routeType:x&&x.routeType,invalid:invalidIds.indexOf(String(x&&x.inquiryId))!==-1}});
  }
  function installAssignmentTrace(){
    if(window.__gbx1172AssignmentTraceInstalled)return;
    var current;
    try{current=window.goodsbarnxAllocationCandidates}catch(e){current=undefined}
    try{
      Object.defineProperty(window,"goodsbarnxAllocationCandidates",{
        configurable:true,enumerable:true,
        get:function(){return current},
        set:function(v){
          current=v;
          var arr=Array.isArray(v)?v:[];
          assignments.push({time:new Date().toISOString(),count:arr.length,invalidIds:[],snapshot:snapshot(arr,window.__gbx1172InvalidIds||[]),stack:stack()});
        }
      });
      window.__gbx1172AssignmentTraceInstalled=true;
    }catch(e){window.__gbx1172AssignmentTraceInstallError=String(e&&e.message||e)}
  }
  function wrapProducer(){
    if(wrapped||typeof window.refreshDepletorAllocation!=="function")return false;
    originalRefresh=window.refreshDepletorAllocation;
    producerSource=String(originalRefresh);
    window.__gbx1172ProducerName="refreshDepletorAllocation";
    window.__gbx1172ProducerSource=producerSource;
    window.refreshDepletorAllocation=async function(){
      var before=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates.slice():null;
      var t=performance.now();
      var args=[];for(var i=0;i<arguments.length;i++)args.push(arguments[i]);
      var call={startedAt:new Date().toISOString(),functionName:"refreshDepletorAllocation",argumentCount:args.length,beforeCount:before?before.length:null};
      try{
        var result=await originalRefresh.apply(this,arguments);
        call.durationMs=Math.round(performance.now()-t);
        call.returnIsArray=Array.isArray(result);
        call.returnCount=Array.isArray(result)?result.length:null;
        call.afterCount=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates.length:null;
        call.returnSnapshot=snapshot(result,window.__gbx1172InvalidIds||[]);
        call.afterSnapshot=snapshot(window.goodsbarnxAllocationCandidates,window.__gbx1172InvalidIds||[]);
        call.stack=stack();
        call.status="resolved";
        invocations.push(call);
        return result;
      }catch(e){
        call.durationMs=Math.round(performance.now()-t);call.status="rejected";call.error=String(e&&e.message||e);call.stack=stack();invocations.push(call);throw e;
      }
    };
    wrapped=true;return true;
  }
  function sourceMarker(re,label,pattern){push(re,producerSource&&pattern.test(producerSource)?"VALID":"INVALID","Allocation producer source marker · "+label,producerSource&&pattern.test(producerSource)?"marker present in actual runtime function source":"marker not present in actual runtime function source")}
  function waitForRuntime(){return typeof window.refreshDepletorAllocation==="function"&&typeof sb!=="undefined"}
  function finish(checks,rows,invalidIds,assignmentsOut,invocationsOut,qms,marker,source){
    var status=el("v18268-isolation-status"),metrics=el("v18268-isolation-metrics"),output=el("v18268-isolation-output");
    var invalidRefs=[];assignmentsOut.forEach(function(a){(a.snapshot||[]).forEach(function(x){if(x.invalid)invalidRefs.push(x)})});
    var invoked=invocationsOut.length>0, observedCandidate=invalidRefs.length>0;
    var conclusion=observedCandidate?"INVALID inquiry reached candidate output; producer path resolved.":invoked?"Producer executed; INVALID inquiry did not appear in candidate output.":"Producer invocation was not observed.";
    var validCount=rows.filter(function(i){return classify(i)==="VALID"}).length;
    var invalidCount=invalidIds.length;
    var missingCount=rows.filter(function(i){return classify(i)==="MISSING"}).length;
    var ambCount=rows.filter(function(i){return classify(i)==="AMBIGUOUS"}).length;
    var unsCount=rows.filter(function(i){return classify(i)==="UNSUPPORTED"}).length;
    var pass=checks.every(function(x){return x.kind==="VALID"||x.kind==="MISSING"&&x.name==="Candidate surface assignment trace"});
    var hasResolution=invoked&&producerSource&&/goodsbarnxAllocationCandidates\s*=/.test(producerSource)&&/readEvidence/.test(producerSource)&&/out\.push\s*\(/.test(producerSource);
    var blocking=!hasResolution;
    if(status){status.textContent=VERSION+" "+(blocking?"BLOCKED":"RESOLUTION COMPLETE")+"\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n")}
    if(metrics){metrics.textContent="INQUIRIES "+rows.length+" · INVALID "+invalidCount+" · PRODUCER INVOCATIONS "+invocationsOut.length+" · ASSIGNMENTS "+assignmentsOut.length+" · INVALID CANDIDATES "+invalidRefs.length}
    if(output){
      var s=[];
      s.push("ALLOCATION CANDIDATE PRODUCER RESOLUTION TRACE");
      s.push("");s.push("Page URL: "+location.href);s.push("Build marker: "+marker);s.push("Auth runtime: "+safe(window.goodsbarnxAuthContextVersion));s.push("Allocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion));s.push("Query time ms: "+qms);
      s.push("");s.push("RESOLUTION CONTRACT");s.push("• Resolve the actual runtime producer before any allocation fix.");s.push("• Candidate construction is identified from the real function source, not an assumed marker.");s.push("• Producer invocation and returned candidate output are captured after instrumentation.");s.push("• INVALID candidate presence is measured separately from actionability.");s.push("• No producer logic, data, or commercial state is modified.");
      s.push("");s.push("PRODUCER");s.push("function="+(window.__gbx1172ProducerName||"none"));s.push("wrapped="+wrapped);s.push("sourceLength="+producerSource.length);s.push("sourceIdentity="+(producerSource?producerSource.slice(0,220).replace(/\s+/g," "):"none"));
      s.push("");s.push("PRODUCER INVOCATIONS");
      if(!invocationsOut.length)s.push("None observed");else invocationsOut.forEach(function(x,i){s.push("["+(i+1)+"] function="+x.functionName+" | status="+x.status+" | durationMs="+safe(x.durationMs)+" | before="+safe(x.beforeCount)+" | returnCount="+safe(x.returnCount)+" | after="+safe(x.afterCount)+" | returnIsArray="+x.returnIsArray);});
      s.push("");s.push("RUNTIME CANDIDATE-SURFACE ASSIGNMENTS");
      if(!assignmentsOut.length)s.push("None observed");else assignmentsOut.forEach(function(a,i){s.push("["+(i+1)+"] time="+a.time+" | count="+a.count+" | invalidRefs="+(a.snapshot||[]).filter(function(x){return x.invalid}).length);});
      s.push("");s.push("INVALID CANDIDATE REFERENCES");
      if(!invalidRefs.length)s.push("None");else invalidRefs.forEach(function(x,i){s.push("["+(i+1)+"] inquiry_id="+x.inquiryId+" | product_id="+safe(x.productId)+" | routeStatus="+safe(x.routeStatus)+" | allocatableQuantity="+safe(x.allocatableQuantity)+" | routeType="+safe(x.routeType));});
      s.push("");s.push("TRANSITION CONCLUSION");s.push(conclusion);
      s.push("");s.push("No database write executed.");s.push("No data repaired.");s.push("No stock mutation.");s.push("No relationship activation.");s.push("No routing/scoring mutation.");s.push("No allocation producer logic modified.");
      output.textContent=s.join("\n");
    }
  }
  async function run(){
    if(started||waiting)return;
    var status=el("v18268-isolation-status"),metrics=el("v18268-isolation-metrics"),output=el("v18268-isolation-output");if(!status||!metrics||!output)return;
    installAssignmentTrace();wrapProducer();
    var marker=document.documentElement.getAttribute("data-goodsbarnx-build")||((document.querySelector('meta[name="goodsbarnx-build"]')||{}).content)||"missing",c=ctx(),u=user(),checks=[];
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
      if(!waitStarted)waitStarted=performance.now();status.textContent=VERSION+" WAITING FOR RUNTIME RESOLUTION\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n")+"\n\nWaiting for allocation producer.";metrics.textContent="Producer resolution waiting for authenticated distributor and allocation runtime.";output.textContent="Read-only boundary.\nNo database write executed.\nNo producer resolution executed.";
      if(performance.now()-waitStarted<MAX_WAIT){waiting=true;setTimeout(function(){waiting=false;run()},RETRY);return;}started=true;return;
    }
    started=true;
    var id=u.id,t=performance.now(),r=await sb.from("inquiries").select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",id).order("created_at",{ascending:false});
    var qms=Math.round(performance.now()-t),rows=r.data||[];
    if(r.error){push(checks,"INVALID","Raw inquiry evidence query",r.error.message);finish(checks,rows,[],[],[],qms,marker,producerSource);return;}
    push(checks,"VALID","Raw inquiry evidence query","read-only query returned without error");
    var outside=rows.filter(function(x){return String(x.distributor_id)!==String(id)}).length;push(checks,outside?"INVALID":"VALID","Inquiry distributor ownership",outside?outside+" row(s) outside authenticated scope":rows.length+" row(s) scoped to principal");
    var invalidIds=[];rows.forEach(function(i){if(classify(i)==="INVALID")invalidIds.push(String(i.id))});window.__gbx1172InvalidIds=invalidIds;
    push(checks,invalidIds.length===1?"VALID":invalidIds.length>0?"INVALID":"INVALID","INVALID evidence cardinality",invalidIds.length+" INVALID inquiry"+(invalidIds.length===1?"":"ies")+" identified");
    var beforeInv=invocations.length,beforeAssign=assignments.length;
    try{await window.refreshDepletorAllocation()}catch(e){push(checks,"INVALID","Allocation producer execution","producer rejected: "+safe(e&&e.message||e))}
    var newInv=invocations.slice(beforeInv),newAssign=assignments.slice(beforeAssign);
    push(checks,newInv.length>0?"VALID":"MISSING","Allocation producer invocation","refreshDepletorAllocation invoked by diagnostic: "+newInv.length+" execution(s)");
    push(checks,producerSource&&/readEvidence/.test(producerSource)?"VALID":"INVALID","Actual producer reads inquiry evidence",producerSource&&/readEvidence/.test(producerSource)?"readEvidence marker present":"readEvidence marker absent");
    sourceMarker(checks,"candidate construction",/out\.push\s*\(\s*\{\s*inquiryId\s*:/);
    sourceMarker(checks,"candidate surface assignment",/goodsbarnxAllocationCandidates\s*=/);
    push(checks,newAssign.length>0?"VALID":"MISSING","Runtime candidate-surface assignment trace",newAssign.length>0?newAssign.length+" assignment(s) observed during controlled producer execution":"no assignment observed during controlled producer execution");
    var allCandidates=Array.isArray(window.goodsbarnxAllocationCandidates)?window.goodsbarnxAllocationCandidates:[];
    var invalidRefs=[];allCandidates.forEach(function(x){if(invalidIds.indexOf(String(x&&x.inquiryId))!==-1)invalidRefs.push(x)});
    push(checks,"VALID","INVALID candidate presence at resolved output",invalidRefs.length?invalidRefs.length+" INVALID candidate reference(s) observed":"none observed");
    var actionInvalid=invalidRefs.filter(function(x){return Number(x&&x.allocatableQuantity)>0&&String(x&&x.routeStatus)==="READY"});
    push(checks,actionInvalid.length?"INVALID":"VALID","INVALID candidate actionability",actionInvalid.length?actionInvalid.length+" INVALID candidate(s) are actionable":"no actionable INVALID candidates");
    finish(checks,rows,invalidIds,newAssign,newInv,qms,marker,producerSource);
  }
  document.addEventListener("DOMContentLoaded",function(){setTimeout(run,120)});
})();
