/* GoodsbarnX V1.8.2.6.8.1.1.5 — Malformed Demand Evidence Boundary
   Read-only diagnostic. Detects malformed legacy demand evidence without repair or inference.
   No database writes, stock mutation, relationship activation, routing, scoring, candidate mutation, or order creation.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6.8.1.1.5";
  var EXPECTED={build:VERSION,authVersion:"V1.8.2.6.6.4",allocationVersion:"V1.8.2.6"};
  var started=false,waiting=false,waitStarted=0,MAX_WAIT=15000,RETRY=250;
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
  function summary(a){var s={VALID:0,INVALID:0,MISSING:0,AMBIGUOUS:0,UNSUPPORTED:0};a.forEach(function(x){s[x.kind]++});return s}
  function forensic(i,field,predicate,raw,normalized,reason){return {inquiry_id:safe(i.id),item:safe(i.item),buyer_id:safe(i.buyer_id),inquirer_id:safe(i.inquirer_id),quantity:safe(i.quantity),order_scale:safe(i.order_scale),status:safe(i.status),field:field,predicate:predicate,raw_value:safe(raw),normalized_value:safe(normalized),reason:reason}}
  async function run(){
    if(started||waiting)return;
    var status=el("v18268-evidence-status"),metrics=el("v18268-evidence-metrics"),output=el("v18268-evidence-output");
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
      status.textContent=VERSION+" WAITING FOR VALID DISTRIBUTOR CONTEXT\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n")+"\n\nNo inquiry evidence evaluated.";
      output.textContent="Read-only boundary.\nNo database write executed.\nNo data repaired.\nNo stock mutation.\nNo routing/scoring/order mutation.";
      if(performance.now()-waitStarted<MAX_WAIT){waiting=true;setTimeout(function(){waiting=false;run()},RETRY);return;}
      started=true;return;
    }
    started=true;
    var id=u.id,t=performance.now(),r=await sb.from("inquiries").select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",id).order("created_at",{ascending:false});
    var qms=Math.round(performance.now()-t),records=checks.slice(),rows=r.data||[],forensics=[];
    if(r.error)push(records,"INVALID","Raw inquiry evidence query",r.error.message);else push(records,"VALID","Raw inquiry evidence query","read-only query returned without error");
    var outside=rows.filter(function(x){return String(x.distributor_id)!==String(id)}).length;
    push(records,outside?"INVALID":"VALID","Inquiry distributor ownership",outside?outside+" row(s) outside authenticated scope":rows.length+" row(s) scoped to principal");
    var invalid=0,missing=0,ambiguous=0,unsupported=0;
    rows.forEach(function(i){
      if(!validId(i.id)){invalid++;forensics.push(forensic(i,"id","validId(id)",i.id,"","Inquiry id is missing or blank."))}
      if(!text(i.item)){missing++;forensics.push(forensic(i,"item","non-empty demand item",i.item,"","Demand item is missing or blank."))}
      if(i.quantity==null||String(i.quantity).trim()===""){missing++;forensics.push(forensic(i,"quantity","quantity is present",i.quantity,"","Quantity is missing."))}
      else if(!positiveNumeric(i.quantity)){invalid++;forensics.push(forensic(i,"quantity","numeric(quantity) && Number(quantity) > 0",i.quantity,numeric(i.quantity)?String(Number(i.quantity)):"NaN",!numeric(i.quantity)?"Quantity is not numeric; no conversion or inference permitted.":"Quantity must be greater than zero."))}
      if(i.order_scale==null||String(i.order_scale).trim()===""){missing++;forensics.push(forensic(i,"order_scale","order_scale is present",i.order_scale,"","Commercial unit is missing; never substitute it for quantity."))}
      var st=String(i.status||"").trim().toLowerCase();
      if(!st){missing++;forensics.push(forensic(i,"status","supported inquiry status",i.status,"","Inquiry status is missing."))}
      else if(["open","pending","closed","resolved","completed"].indexOf(st)===-1){unsupported++;forensics.push(forensic(i,"status","supported inquiry status",i.status,st,"Status is outside the diagnostic-supported set."))}
      if(i.buyer_id==null&&i.inquirer_id==null){missing++;forensics.push(forensic(i,"buyer attribution","buyer_id or inquirer_id is present",null,"","Buyer identity is absent; no identity inference permitted."))}
      if(i.buyer_id!=null&&i.inquirer_id!=null&&String(i.buyer_id)!==String(i.inquirer_id)){ambiguous++;forensics.push(forensic(i,"buyer_id/inquirer_id","buyer_id === inquirer_id when both are present",String(i.buyer_id)+" / "+String(i.inquirer_id),"","Buyer attribution fields conflict."))}
    });
    push(records,invalid?"INVALID":"VALID","Demand evidence quantitative integrity",invalid?invalid+" invalid condition(s)":rows.length+" inquiry row(s) checked");
    push(records,missing?"MISSING":"VALID","Demand evidence required-field presence",missing?missing+" missing condition(s)":"required evidence fields present");
    push(records,unsupported?"UNSUPPORTED":"VALID","Inquiry status support",unsupported?unsupported+" unsupported condition(s)":"all statuses supported");
    push(records,ambiguous?"AMBIGUOUS":"VALID","Buyer attribution coherence",ambiguous?ambiguous+" conflicting attribution condition(s)":"no conflicting attribution pair");
    var s=summary(records),hard=s.INVALID>0||s.AMBIGUOUS>0||s.UNSUPPORTED>0;
    metrics.textContent="INQUIRIES "+rows.length+"  ·  VALID "+s.VALID+"  ·  INVALID "+s.INVALID+"  ·  MISSING "+s.MISSING+"  ·  AMBIGUOUS "+s.AMBIGUOUS+"  ·  UNSUPPORTED "+s.UNSUPPORTED;
    status.textContent=(hard?VERSION+" MALFORMED DEMAND EVIDENCE BLOCKED":VERSION+" MALFORMED DEMAND EVIDENCE PASSED")+"\n\n"+records.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n");
    output.textContent="MALFORMED DEMAND EVIDENCE TRACE\n\nPage URL: "+location.href+"\nBuild marker: "+marker+"\nAuth runtime: "+safe(window.goodsbarnxAuthContextVersion)+"\nAllocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion)+"\nQuery time ms: "+qms+"\n\nBOUNDARY RULES\n• quantity must be numeric and > 0.\n• order_scale is independent and is never substituted for quantity.\n• missing buyer identity remains MISSING; it is never inferred.\n• conflicting buyer_id/inquirer_id remains AMBIGUOUS.\n• malformed evidence blocks actionability; it is not repaired here.\n\nFORENSICS\n"+(forensics.length?forensics.map(function(f,n){return "\n["+(n+1)+"] "+Object.keys(f).map(function(k){return k+"="+f[k]}).join(" | ")}).join("\n"):"No predicate violations recorded.")+"\n\nNo database write executed.\nNo data repaired.\nNo stock mutation.\nNo relationship activation.\nNo routing/scoring mutation.\nNo order created.\nAllocation runtime remains V1.8.2.6 and read-only.";
  }
  document.addEventListener("DOMContentLoaded",function(){setTimeout(run,400)});
  window.addEventListener("load",function(){setTimeout(run,400)});
})();
