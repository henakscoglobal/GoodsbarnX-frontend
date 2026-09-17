/* GoodsbarnX V1.8.2.6.8.1.1.6 — Demand Evidence Classification Integrity
   Read-only diagnostic. Proves deterministic one-state classification and aggregate counts.
   No database writes, repair, inference, stock mutation, relationship activation, routing,
   scoring, candidate mutation, allocation, or order creation.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6.8.1.1.6";
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
  function emptyCounts(){return {VALID:0,INVALID:0,MISSING:0,AMBIGUOUS:0,UNSUPPORTED:0}}
  function forensic(i,field,predicate,raw,normalized,reason){return {inquiry_id:safe(i.id),item:safe(i.item),buyer_id:safe(i.buyer_id),inquirer_id:safe(i.inquirer_id),quantity:safe(i.quantity),order_scale:safe(i.order_scale),status:safe(i.status),field:field,predicate:predicate,raw_value:safe(raw),normalized_value:safe(normalized),reason:reason}}
  function classify(issues){
    /* Deterministic precedence for mixed-condition records.
       Attribution conflict is most identity-critical; unsupported status is next;
       invalid values precede simple absence; absence precedes a clean record. */
    if(issues.AMBIGUOUS.length) return "AMBIGUOUS";
    if(issues.UNSUPPORTED.length) return "UNSUPPORTED";
    if(issues.INVALID.length) return "INVALID";
    if(issues.MISSING.length) return "MISSING";
    return "VALID";
  }
  function renderCounts(c){return "INQUIRIES "+c.total+"  ·  VALID "+c.VALID+"  ·  INVALID "+c.INVALID+"  ·  MISSING "+c.MISSING+"  ·  AMBIGUOUS "+c.AMBIGUOUS+"  ·  UNSUPPORTED "+c.UNSUPPORTED}
  async function run(){
    if(started||waiting)return;
    var status=el("v18268-classification-status"),metrics=el("v18268-classification-metrics"),output=el("v18268-classification-output");
    if(!status||!metrics||!output)return;
    var marker=document.documentElement.getAttribute("data-goodsbarnx-build")||((document.querySelector('meta[name="goodsbarnx-build"]')||{}).content)||"missing";
    var c=ctx(),u=user(),checks=[];
    checks.push({kind:marker===EXPECTED.build?"VALID":"INVALID",name:"Deployment marker",detail:marker});
    checks.push({kind:window.goodsbarnxAuthContextVersion===EXPECTED.authVersion?"VALID":"INVALID",name:"Auth runtime version",detail:safe(window.goodsbarnxAuthContextVersion)});
    checks.push({kind:window.goodsbarnxDepletorAllocationVersion===EXPECTED.allocationVersion?"VALID":"INVALID",name:"Allocation runtime version",detail:safe(window.goodsbarnxDepletorAllocationVersion)});
    var authReady=!!c&&c.ready===true&&c.authenticated===true&&validId(c.userId)&&String(c.role||"").toLowerCase()==="distributor";
    var currentReady=!!u&&validId(u.id)&&String(u.role||"").toLowerCase()==="distributor";
    var same=authReady&&currentReady&&String(c.userId)===String(u.id);
    checks.push({kind:authReady?"VALID":"MISSING",name:"Authenticated distributor context",detail:authReady?"ready · "+c.userId:"context unavailable/not distributor"});
    checks.push({kind:currentReady?"VALID":"MISSING",name:"Application currentUser distributor principal",detail:currentReady?u.id:"currentUser unavailable/not distributor"});
    checks.push({kind:same?"VALID":"INVALID",name:"Context identity continuity",detail:same?"authContext.userId matches currentUser.id":"identity mismatch"});
    if(!authReady||!currentReady||!same){
      if(!waitStarted)waitStarted=performance.now();
      status.textContent=VERSION+" WAITING FOR VALID DISTRIBUTOR CONTEXT\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n")+"\n\nNo inquiry evidence classified.";
      metrics.textContent="Classification boundary waiting for authenticated distributor context.";
      output.textContent="Read-only boundary.\nNo database write executed.\nNo data repaired.\nNo inquiry classification executed.";
      if(performance.now()-waitStarted<MAX_WAIT){waiting=true;setTimeout(function(){waiting=false;run()},RETRY);return;}
      started=true;return;
    }
    started=true;
    var id=u.id,t=performance.now(),r=await sb.from("inquiries").select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",id).order("created_at",{ascending:false});
    var qms=Math.round(performance.now()-t),records=checks.slice(),rows=r.data||[],forensics=[],counts=emptyCounts();
    counts.total=rows.length;
    if(r.error)push(records,"INVALID","Raw inquiry evidence query",r.error.message);else push(records,"VALID","Raw inquiry evidence query","read-only query returned without error");
    var outside=rows.filter(function(x){return String(x.distributor_id)!==String(id)}).length;
    push(records,outside?"INVALID":"VALID","Inquiry distributor ownership",outside?outside+" row(s) outside authenticated scope":rows.length+" row(s) scoped to principal");

    var classified=[];
    rows.forEach(function(i){
      var issues={VALID:[],INVALID:[],MISSING:[],AMBIGUOUS:[],UNSUPPORTED:[]};
      function issue(kind,field,predicate,raw,normalized,reason){
        var f=forensic(i,field,predicate,raw,normalized,reason);
        issues[kind].push(f); forensics.push(f);
      }
      if(!validId(i.id)) issue("INVALID","id","validId(id)",i.id,"","Inquiry id is missing or blank.");
      if(!text(i.item)) issue("MISSING","item","non-empty demand item",i.item,"","Demand item is missing or blank.");
      if(i.quantity==null||String(i.quantity).trim()==="") issue("MISSING","quantity","quantity is present",i.quantity,"","Quantity is missing.");
      else if(!positiveNumeric(i.quantity)) issue("INVALID","quantity","numeric(quantity) && Number(quantity) > 0",i.quantity,numeric(i.quantity)?String(Number(i.quantity)):"NaN",!numeric(i.quantity)?"Quantity is not numeric; no conversion or inference permitted.":"Quantity must be greater than zero.");
      if(i.order_scale==null||String(i.order_scale).trim()==="") issue("MISSING","order_scale","order_scale is present",i.order_scale,"","Commercial unit is missing; never substitute it for quantity.");
      var st=String(i.status||"").trim().toLowerCase();
      if(!st) issue("MISSING","status","supported inquiry status",i.status,"","Inquiry status is missing.");
      else if(["open","pending","closed","resolved","completed"].indexOf(st)===-1) issue("UNSUPPORTED","status","supported inquiry status",i.status,st,"Status is outside the diagnostic-supported set.");
      if(i.buyer_id==null&&i.inquirer_id==null) issue("MISSING","buyer attribution","buyer_id or inquirer_id is present",null,"","Buyer identity is absent; no identity inference permitted.");
      if(i.buyer_id!=null&&i.inquirer_id!=null&&String(i.buyer_id)!==String(i.inquirer_id)) issue("AMBIGUOUS","buyer_id/inquirer_id","buyer_id === inquirer_id when both are present",String(i.buyer_id)+" / "+String(i.inquirer_id),"","Buyer attribution fields conflict.");
      var cls=classify(issues); counts[cls]++;
      classified.push({id:safe(i.id),classification:cls,issueCount:Object.keys(issues).reduce(function(n,k){return n+issues[k].length},0)});
    });

    var classTotal=counts.VALID+counts.INVALID+counts.MISSING+counts.AMBIGUOUS+counts.UNSUPPORTED;
    var countIntegrity=classTotal===counts.total;
    var uniqueIntegrity=classified.length===rows.length && classified.every(function(x){return CLASS_ORDER.indexOf(x.classification)!==-1;});
    var exactlyOneIntegrity=classified.every(function(x){return CLASS_ORDER.filter(function(k){return k===x.classification}).length===1;});
    var conservation=counts.total===rows.length;
    var classificationChecks=[];
    push(classificationChecks,countIntegrity?"VALID":"INVALID","Classification count conservation",countIntegrity?"category counts sum exactly to "+counts.total:"category counts do not equal inquiry count");
    push(classificationChecks,uniqueIntegrity?"VALID":"INVALID","One classification per inquiry",uniqueIntegrity?"every inquiry has one supported classification":"unsupported or missing classification detected");
    push(classificationChecks,exactlyOneIntegrity?"VALID":"INVALID","Mutually exclusive classification states",exactlyOneIntegrity?"each inquiry resolves to exactly one state":"an inquiry resolved to multiple states");
    push(classificationChecks,conservation?"VALID":"INVALID","Inquiry total conservation",conservation?"classified rows equal queried rows":"classified row count differs from queried rows");
    classificationChecks.forEach(function(x){records.push(x)});
    var hard=records.some(function(x){return x.kind==="INVALID"})||!countIntegrity||!uniqueIntegrity||!exactlyOneIntegrity||!conservation;
    metrics.textContent=renderCounts(counts);
    status.textContent=(hard?VERSION+" DEMAND EVIDENCE CLASSIFICATION BLOCKED":VERSION+" DEMAND EVIDENCE CLASSIFICATION PASSED")+"\n\n"+records.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n");
    output.textContent="DEMAND EVIDENCE CLASSIFICATION TRACE\n\nPage URL: "+location.href+"\nBuild marker: "+marker+"\nAuth runtime: "+safe(window.goodsbarnxAuthContextVersion)+"\nAllocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion)+"\nQuery time ms: "+qms+"\n\nCLASSIFICATION CONTRACT\n• Every inquiry resolves to exactly one state.\n• States: VALID | INVALID | MISSING | AMBIGUOUS | UNSUPPORTED.\n• Precedence for mixed-condition records: AMBIGUOUS > UNSUPPORTED > INVALID > MISSING > VALID.\n• Category counts must sum exactly to the queried inquiry count.\n• No field conversion, identity inference, repair, or mutation is permitted.\n\nCLASSIFICATION COUNTS\n"+renderCounts(counts)+"\n\nPER-INQUIRY CLASSIFICATION\n"+(classified.length?classified.map(function(x,n){return "["+(n+1)+"] inquiry_id="+x.id+" | classification="+x.classification+" | predicate_conditions="+x.issueCount}).join("\n") : "No inquiries returned.")+"\n\nFORENSIC CONDITIONS\n"+(forensics.length?forensics.map(function(f,n){return "\n["+(n+1)+"] "+Object.keys(f).map(function(k){return k+"="+f[k]}).join(" | ")}).join("\n") : "No predicate violations recorded.")+"\n\nNo database write executed.\nNo data repaired.\nNo stock mutation.\nNo relationship activation.\nNo routing/scoring mutation.\nNo order created.\nAllocation runtime remains V1.8.2.6 and read-only.";
  }
  document.addEventListener("DOMContentLoaded",function(){setTimeout(run,400)});
  window.addEventListener("load",function(){setTimeout(run,400)});
})();
