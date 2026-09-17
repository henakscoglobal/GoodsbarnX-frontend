/* GoodsbarnX V1.8.2.6.8.1.1.3 — Inquiry Evidence Contract Boundary
   Diagnostic only. Establishes the semantic contract for inquiry evidence consumed by the read-only Allocation runtime.
   No writes, no data repair, no stock mutation, no allocation/scoring changes.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6.8.1.1.3";
  var EXPECTED={build:"GBX-V1.8.2.6.8.1.1.3-EVIDENCE-INTEGRITY-20260917",authVersion:"V1.8.2.6.6.4",allocationVersion:"V1.8.2.6"};
  var running=false,started=false,waiting=false,waitStarted=0;
  var MAX_AUTH_WAIT_MS=15000,AUTH_RETRY_MS=250;
  function el(id){return document.getElementById(id)}
  function safe(v){return v==null?"none":String(v)}
  function line(kind,name,detail){var mark=kind==="VALID"?"✓ VALID":kind==="INVALID"?"✗ INVALID":kind==="MISSING"?"⚠ MISSING":kind==="AMBIGUOUS"?"⚠ AMBIGUOUS":"? UNSUPPORTED";return mark+" — "+name+(detail?": "+detail:"")}
  function user(){try{return typeof currentUser!=="undefined"?currentUser:null}catch(e){return null}}
  function ctx(){return window.goodsbarnxAuthContext||null}
  function validId(v){return typeof v==="string"&&v.trim().length>0}
  function text(v){return typeof v==="string"&&v.trim().length>0}
  function numeric(v){if(typeof v==="number")return Number.isFinite(v);if(typeof v==="string"&&v.trim()!=="")return Number.isFinite(Number(v));return false}
  function positiveNumeric(v){return numeric(v)&&Number(v)>0}
  function summarize(records){var s={VALID:0,INVALID:0,MISSING:0,AMBIGUOUS:0,UNSUPPORTED:0};records.forEach(function(r){s[r.kind]++});return s}
  function push(records,kind,name,detail){records.push({kind:kind,name:name,detail:detail});}
  function forensic(inquiry,field,predicate,raw,normalized,reason){return {inquiry_id:safe(inquiry.id),item:safe(inquiry.item),buyer_id:safe(inquiry.buyer_id),inquirer_id:safe(inquiry.inquirer_id),quantity:safe(inquiry.quantity),order_scale:safe(inquiry.order_scale),status:safe(inquiry.status),field:field,predicate:predicate,raw_value:safe(raw),normalized_value:safe(normalized),reason:reason}}
  async function run(){
    if(running||started||waiting)return;
    var panel=el("v18268-evidence-integrity"),status=el("v18268-test-status"),metrics=el("v18268-test-metrics"),output=el("v18268-test-output");
    try{
      if(!panel||!status||!metrics||!output)return;
      panel.classList.add("gbx-v18268-visible");
      var marker=document.documentElement.getAttribute("data-goodsbarnx-build")||(document.querySelector('meta[name="goodsbarnx-build"]')||{}).content||"missing";
      var c=ctx(),u=user(),checks=[];
      checks.push({kind:marker===EXPECTED.build?"VALID":"INVALID",name:"Deployment marker",detail:marker});
      checks.push({kind:window.goodsbarnxAuthContextVersion===EXPECTED.authVersion?"VALID":"INVALID",name:"Auth runtime version",detail:safe(window.goodsbarnxAuthContextVersion)});
      checks.push({kind:window.goodsbarnxDepletorAllocationVersion===EXPECTED.allocationVersion?"VALID":"INVALID",name:"Allocation runtime version",detail:safe(window.goodsbarnxDepletorAllocationVersion)});
      if(!c||c.ready!==true){
        if(!waitStarted)waitStarted=performance.now();
        status.className="gbx-v18268-status gbx-v18268-warn";
        status.textContent=VERSION+" WAITING FOR AUTH CONTEXT\n\nAuthentication resolver is still initializing. No inquiry contract evaluated.";
        output.textContent="Waiting for the existing authentication boundary to resolve.\nNo inquiry evidence evaluated.\nNo database write executed.\nNo stock mutation executed.\nAllocation runtime remains V1.8.2.6 and read-only.";
        if(performance.now()-waitStarted<MAX_AUTH_WAIT_MS){waiting=true;setTimeout(function(){waiting=false;run()},AUTH_RETRY_MS);return;}
        started=true;running=true;
      }else{started=true;running=true;}
      c=ctx();u=user();
      var authReady=!!c&&c.ready===true&&c.authenticated===true&&validId(c.userId)&&String(c.role||"").toLowerCase()==="distributor";
      var currentReady=!!u&&validId(u.id)&&String(u.role||"").toLowerCase()==="distributor";
      var same=authReady&&currentReady&&String(c.userId)===String(u.id);
      checks.push({kind:authReady?"VALID":"MISSING",name:"Authenticated distributor context",detail:authReady?"ready · "+c.userId:(c&&c.state?"context state = "+c.state:"context unavailable")});
      checks.push({kind:currentReady?"VALID":"MISSING",name:"Application currentUser distributor principal",detail:currentReady?u.id:"currentUser unavailable"});
      checks.push({kind:same?"VALID":"INVALID",name:"Context identity continuity",detail:same?"authContext.userId matches currentUser.id":"identity mismatch"});
      if(!authReady||!currentReady||!same){
        status.className="gbx-v18268-status gbx-v18268-warn";
        status.textContent=VERSION+" AWAITING VALID ALLOCATION CONTEXT\n\n"+checks.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n")+"\n\n⚠ WAIT — Inquiry evidence contract is not evaluated until the authenticated distributor boundary is valid.";
        output.textContent="No inquiry evidence evaluated.\nNo database write executed.\nNo stock mutation executed.\nAllocation runtime remains V1.8.2.6 and read-only.";
        return;
      }
      var id=u.id,queryStarted=performance.now();
      var rs=await Promise.all([
        sb.from("products").select("id,name,price,stock_quantity,status,category,distributor_id").eq("distributor_id",id),
        sb.from("inquiries").select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",id).order("created_at",{ascending:false}),
        sb.from("trade_relationships").select("id,buyer_id,distributor_id,status,is_primary").eq("distributor_id",id),
        sb.from("agent_distributor_attachments").select("id,agent_id,distributor_id,status").eq("distributor_id",id)
      ]);
      var queryMs=Math.round(performance.now()-queryStarted),errors=rs.map(function(r){return r.error||null});
      var records=[];
      if(errors.some(Boolean)){push(records,"INVALID","Raw evidence query execution",errors.map(function(e){return e?e.message:"ok"}).join(" | "));}
      else push(records,"VALID","Raw evidence queries","4/4 read-only queries returned without error");
      var products=rs[0].data||[],inquiries=rs[1].data||[],rels=rs[2].data||[],agents=rs[3].data||[];
      function ownership(rows,label){var bad=rows.filter(function(r){return String(r.distributor_id)!==String(id)});push(records,bad.length?"INVALID":"VALID",label,bad.length?bad.length+" row(s) outside authenticated distributor scope":rows.length+" row(s) scoped to principal");}
      ownership(products,"Products distributor ownership");
      ownership(inquiries,"Inquiries distributor ownership");
      ownership(rels,"Relationships distributor ownership");
      ownership(agents,"Agent attachments distributor ownership");
      var productInvalid=0,productMissing=0;
      products.forEach(function(p){if(!validId(p.id))productInvalid++;if(p.stock_quantity==null)productMissing++;else if(!numeric(p.stock_quantity)||Number(p.stock_quantity)<0)productInvalid++;});
      push(records,productInvalid?"INVALID":"VALID","Product identity + stock quantity integrity",productInvalid?productInvalid+" invalid row/field condition(s)":products.length+" product row(s) checked");
      push(records,productMissing?"MISSING":"VALID","Product stock quantity presence",productMissing?productMissing+" product(s) missing stock_quantity":"all product rows have stock_quantity");

      var inquiryInvalid=0,inquiryMissing=0,inquiryAmbiguous=0,inquiryUnsupported=0;
      var itemMissing=0,scaleMissing=0,attributionMissing=0,inquiryForensics=[];
      inquiries.forEach(function(i){
        if(!validId(i.id)){inquiryInvalid++;inquiryForensics.push(forensic(i,"id","validId(id)",i.id,"","Inquiry id is missing or blank."));}
        if(!text(i.item)){itemMissing++;inquiryForensics.push(forensic(i,"item","non-empty demand item",i.item,"","Demand item is missing or blank."));}
        if(i.quantity==null||String(i.quantity).trim()===""){
          inquiryMissing++;
          inquiryForensics.push(forensic(i,"quantity","quantity is present",i.quantity,"","Demand quantity is missing."));
        }else if(!positiveNumeric(i.quantity)){
          inquiryInvalid++;
          inquiryForensics.push(forensic(i,"quantity","numeric(quantity) && Number(quantity) > 0",i.quantity,numeric(i.quantity)?String(Number(i.quantity)):"NaN",!numeric(i.quantity)?"Quantity is not numeric.":"Quantity must be greater than zero."));
        }
        if(i.order_scale==null||String(i.order_scale).trim()==="")scaleMissing++;
        var st=String(i.status||"").trim().toLowerCase();
        if(!st)inquiryMissing++;
        else if(["open","pending","closed","resolved","completed"].indexOf(st)===-1){inquiryUnsupported++;inquiryForensics.push(forensic(i,"status","supported inquiry status",i.status,st,"Inquiry status is outside the diagnostic-supported status set."));}
        if(i.buyer_id==null&&i.inquirer_id==null)attributionMissing++;
        if(i.buyer_id!=null&&i.inquirer_id!=null&&String(i.buyer_id)!==String(i.inquirer_id)){inquiryAmbiguous++;inquiryForensics.push(forensic(i,"buyer_id/inquirer_id","buyer_id === inquirer_id when both are present",String(i.buyer_id)+" / "+String(i.inquirer_id),String(i.buyer_id)+" / "+String(i.inquirer_id),"Buyer attribution fields conflict."));}
      });
      push(records,inquiryInvalid?"INVALID":"VALID","Inquiry identity + quantitative integrity",inquiryInvalid?inquiryInvalid+" invalid condition(s)":inquiries.length+" inquiry row(s) checked");
      push(records,itemMissing?"MISSING":"VALID","Inquiry demand identity presence",itemMissing?itemMissing+" inquiry(s) missing item":"all inquiry rows have a demand item");
      push(records,inquiryMissing?"MISSING":"VALID","Inquiry required quantity/status presence",inquiryMissing?inquiryMissing+" missing required field condition(s)":"quantity and status present where required");
      push(records,scaleMissing?"MISSING":"VALID","Inquiry commercial unit presence",scaleMissing?scaleMissing+" inquiry(s) missing order_scale":"all inquiry rows have order_scale");
      push(records,inquiryUnsupported?"UNSUPPORTED":"VALID","Inquiry status support",inquiryUnsupported?inquiryUnsupported+" unsupported status condition(s)":"all statuses are schema-supported; terminal statuses remain non-actionable");
      push(records,attributionMissing?"MISSING":"VALID","Inquiry buyer attribution presence",attributionMissing?attributionMissing+" inquiry(s) have neither buyer_id nor inquirer_id":"all inquiry rows have buyer attribution");
      push(records,inquiryAmbiguous?"AMBIGUOUS":"VALID","Buyer attribution coherence",inquiryAmbiguous?inquiryAmbiguous+" inquiry(s) have conflicting buyer_id/inquirer_id":"no conflicting buyer_id/inquirer_id pair detected");

      var relInvalid=0,relMissing=0;
      rels.forEach(function(r){if(!validId(r.id)||!validId(r.buyer_id))relMissing++;var st=String(r.status||"").trim().toLowerCase();if(!st)relMissing++;else if(["active","pending","paused","released","terminated"].indexOf(st)===-1)relInvalid++;if(typeof r.is_primary!=="boolean")relInvalid++;});
      push(records,relMissing?"MISSING":"VALID","Relationship identity + required fields",relMissing?relMissing+" missing relationship field condition(s)":rels.length+" relationship row(s) checked");
      push(records,relInvalid?"UNSUPPORTED":"VALID","Relationship status/primary-state support",relInvalid?relInvalid+" unsupported or malformed relationship condition(s)":"status and is_primary are explicit");
      var agentInvalid=0,agentMissing=0,acceptedAgents=0;
      agents.forEach(function(a){if(!validId(a.id)||!validId(a.agent_id))agentMissing++;var st=String(a.status||"").trim().toLowerCase();if(!st)agentMissing++;else if(["pending","accepted","rejected","paused","terminated"].indexOf(st)===-1)agentInvalid++;if(st==="accepted")acceptedAgents++;});
      push(records,agentMissing?"MISSING":"VALID","Accepted-agent identity fields",agentMissing?agentMissing+" missing identity condition(s)":agents.length+" attachment row(s) checked");
      push(records,agentInvalid?"UNSUPPORTED":"VALID","Agent attachment status",agentInvalid?agentInvalid+" unsupported status condition(s)":"statuses are explicit; accepted capacity="+acceptedAgents);

      var summary=summarize(records),hardFail=summary.INVALID>0||summary.AMBIGUOUS>0||summary.UNSUPPORTED>0;
      metrics.innerHTML='<div class="gbx-v18268-grid"><div><strong>'+products.length+'</strong><span>PRODUCTS</span></div><div><strong>'+inquiries.length+'</strong><span>INQUIRIES</span></div><div><strong>'+rels.length+'</strong><span>RELATIONSHIPS</span></div><div><strong>'+agents.length+'</strong><span>AGENT ATTACHMENTS</span></div></div><div class="gbx-v18268-summary"><b>VALID '+summary.VALID+'</b> · <b>INVALID '+summary.INVALID+'</b> · <b>MISSING '+summary.MISSING+'</b> · <b>AMBIGUOUS '+summary.AMBIGUOUS+'</b> · <b>UNSUPPORTED '+summary.UNSUPPORTED+'</b></div>';
      status.className="gbx-v18268-status "+(hardFail?"gbx-v18268-fail":"gbx-v18268-pass");
      status.textContent=(hardFail?VERSION+" INQUIRY EVIDENCE CONTRACT BLOCKED":VERSION+" INQUIRY EVIDENCE CONTRACT PASSED")+"\n\n"+records.map(function(x){return line(x.kind,x.name,x.detail)}).join("\n");
      var forensicText=inquiryForensics.length?inquiryForensics.map(function(f,n){return "\n["+(n+1)+"] INQUIRY FORENSIC\n"+Object.keys(f).map(function(k){return k+"="+f[k]}).join("\n")}).join("\n"):"\nNo inquiry predicate violations recorded.";
      output.textContent="INQUIRY EVIDENCE CONTRACT TRACE\n\nPage URL: "+location.href+"\nBuild marker: "+marker+"\nAuth runtime: "+safe(window.goodsbarnxAuthContextVersion)+"\nAllocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion)+"\n\nRAW EVIDENCE\nproducts="+products.length+"\ninquiries="+inquiries.length+"\ntrade_relationships="+rels.length+"\nagent_distributor_attachments="+agents.length+"\nquery_time_ms="+queryMs+"\n\nINQUIRY CONTRACT\nDemand identity: item must be non-empty.\nDemand quantity: quantity must be numeric and greater than zero.\nCommercial unit: order_scale is a distinct field and is never substituted for quantity.\nBuyer attribution: buyer_id/inquirer_id may be absent at this boundary, but conflicting values are ambiguous.\nProduct identity: not asserted by this diagnostic unless present in the inquiry schema/runtime contract.\n\nCLASSIFICATION\nVALID="+summary.VALID+"\nINVALID="+summary.INVALID+"\nMISSING="+summary.MISSING+"\nAMBIGUOUS="+summary.AMBIGUOUS+"\nUNSUPPORTED="+summary.UNSUPPORTED+"\n\nINQUIRY FORENSICS"+forensicText+"\n\nNo data repaired.\nNo database write executed.\nNo stock mutation executed.\nNo relationship activated.\nNo order created.\nAllocation runtime remains V1.8.2.6 and read-only.";
    }catch(e){status.className="gbx-v18268-status gbx-v18268-fail";status.textContent=VERSION+" INQUIRY EVIDENCE CONTRACT FAILED\n\n✗ INVALID — Diagnostic execution exception: "+safe(e&&e.message||e);output.textContent="No evidence repaired.\nNo database write executed.\nNo stock mutation executed."}
    finally{running=false}
  }
  document.addEventListener("DOMContentLoaded",function(){setTimeout(run,400)});
  window.addEventListener("load",function(){setTimeout(run,400)});
})();
