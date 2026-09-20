/* GoodsbarnX V1.8.2.6 — Master Stock Depletor: Allocation & Routing Runtime
   Read-only runtime. No writes, no stock mutation, no invented opportunity/order IDs.
*/
(function(){
  "use strict";
  var VERSION="V1.8.2.6";
  window.goodsbarnxDepletorAllocationVersion=VERSION;
  var state={candidates:[],error:null};
  function esc(v){return String(v??"").replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]})}
  function tokens(v){return String(v||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(function(x){return x.length>2})}
  function linked(i,p){var a=tokens(i.item),b=tokens(p.name);return a.length&&b.length&&a.some(function(t){return b.indexOf(t)>=0})&&b.some(function(t){return a.indexOf(t)>=0})}
  function ageHours(v){var t=new Date(v||Date.now()).getTime();return isFinite(t)?Math.max(0,(Date.now()-t)/3600000):999999}
  function score(matches,stock,qty,age){var s=0;if(matches)s+=40;if(stock>0)s+=25;if(qty>0){s+=20;if(stock>=qty)s+=5}if(age<=24)s+=10;else if(age<=168)s+=6;else if(age<=720)s+=2;return Math.min(100,s)}
  function tier(s,stock,matches){if(matches&&stock>0&&s>=75)return"ACT NOW";if(matches&&stock>0)return"READY";if(matches)return"WATCH";if(stock<=0)return"RESTOCK";return"MONITOR"}
  function activeRelationship(i,rels){if(!i.buyer_id)return null;return rels.find(function(r){return r.buyer_id===i.buyer_id&&r.is_primary!==false&&String(r.status||"").toLowerCase()==="active"})||null}
  function blockReason(e){var a=[];if(!e.productDemandMatch)a.push("no product-demand match");if(!e.stockAvailable)a.push("no stock");if(!e.requestedQuantityKnown)a.push("quantity unknown");if(!e.demandIdentity)a.push("buyer identity missing");if(!e.activePrimaryRelationship)a.push("active relationship missing");return a.join("; ")||"evidence incomplete"}
  async function readEvidence(){
    var user=null;try{user=currentUser}catch(e){}
    if(!user||String(user.role||"").toLowerCase()!=="distributor"){throw new Error("AUTH_CONTEXT_UNAVAILABLE");}
    var rs=await Promise.all([
      sb.from("products").select("id,name,price,stock_quantity,status,category").eq("distributor_id",user.id),
      sb.from("inquiries").select("id,item,quantity,status,created_at,buyer_id,distributor_id,inquirer_id").eq("distributor_id",user.id).order("created_at",{ascending:false}),
      sb.from("trade_relationships").select("id,buyer_id,distributor_id,status,is_primary").eq("distributor_id",user.id),
      sb.from("agent_distributor_attachments").select("id,agent_id,status").eq("distributor_id",user.id).eq("status","accepted")
    ]);
    rs.forEach(function(r){if(r.error)throw r.error});
    var products=rs[0].data||[],inquiries=(rs[1].data||[]).filter(function(i){return!["closed","resolved","completed"].includes(String(i.status||"").toLowerCase())}),rels=rs[2].data||[],agents=rs[3].data||[];
    var out=[];
    inquiries.forEach(function(i){
      // V1.8.2.6.8.1.1.8 — invalid demand evidence isolation.
      // Invalid demand remains in the inquiry ledger but MUST NOT cross the
      // allocation candidate-construction boundary.
      var quantityNumber=Number(i.quantity);
      var itemKnown=String(i.item||"").trim().length>0;
      var quantityValid=Number.isFinite(quantityNumber)&&quantityNumber>0;
      if(!itemKnown||!quantityValid)return;
      var matches=products.filter(function(p){return linked(i,p)}),qty=quantityNumber,age=ageHours(i.created_at),rel=activeRelationship(i,rels);
      matches.forEach(function(p){
        var stock=Number(p.stock_quantity)||0,sc=score(matches.length,stock,qty,age);
        var evidence={demandIdentity:!!i.buyer_id,activePrimaryRelationship:!!rel,productDemandMatch:true,stockAvailable:stock>0,requestedQuantityKnown:qty>0,stockCoversRequest:qty>0&&stock>=qty,acceptedAgentCapacity:agents.length>0,freshnessHours:Math.round(age*10)/10};
        var allocatable=evidence.productDemandMatch&&evidence.stockAvailable&&evidence.requestedQuantityKnown&&evidence.demandIdentity&&evidence.activePrimaryRelationship;
        out.push({inquiryId:i.id,productId:p.id,distributorId:user.id,buyerId:i.buyer_id||null,relationshipId:rel?rel.id:null,agentId:null,requestedQuantity:qty,availableQuantity:stock,allocatableQuantity:allocatable?Math.min(stock,qty):0,opportunityScore:sc,opportunityTier:tier(sc,stock,matches.length),routeType:allocatable?"DIRECT_BUYER":"NONE",routeStatus:allocatable?"READY":"BLOCKED",evidence:evidence,blockReason:allocatable?null:blockReason(evidence)});
      });
    });
    out.sort(function(a,b){return(Number(b.allocatableQuantity>0)-Number(a.allocatableQuantity>0))||b.opportunityScore-a.opportunityScore});
    return{candidates:out,acceptedAgents:agents.length};
  }
  function ensurePanel(){
    var root=document.getElementById("depletor-console");if(!root)return null;
    var old=document.getElementById("depletor-allocation-runtime");if(old)return old;
    var s=document.createElement("section");s.id="depletor-allocation-runtime";s.className="depletor-allocation-runtime";
    s.innerHTML='<div class="depletor-heading"><div><span class="intel-label">ALLOCATION &amp; ROUTING</span><h3>Evidence-backed fulfillment paths</h3></div><button type="button" id="depletor-allocation-refresh">Refresh</button></div><div id="depletor-allocation-status" class="depletor-empty">Waiting for allocation evidence…</div><div id="depletor-allocation-list" class="depletor-opportunities"></div>';
    var box=document.getElementById("depletor-opportunities");if(box&&box.parentNode)box.parentNode.insertBefore(s,box.nextSibling);else root.appendChild(s);
    document.getElementById("depletor-allocation-refresh").addEventListener("click",window.refreshDepletorAllocation);return s;
  }
  function render(){
    ensurePanel();var status=document.getElementById("depletor-allocation-status"),list=document.getElementById("depletor-allocation-list");if(!status||!list)return;
    if(state.error){var message=state.error.message||String(state.error);status.textContent=message==="AUTH_CONTEXT_UNAVAILABLE"?"Waiting for authenticated distributor context…":"Allocation runtime unavailable. Existing intelligence remains read-only.";list.innerHTML="";return}
    var c=state.candidates||[],ready=c.filter(function(x){return x.allocatableQuantity>0&&x.routeStatus==="READY"}).length;
    if(!c.length){status.textContent="No evidence-backed allocation candidate is currently available.";list.innerHTML="";return}
    status.innerHTML="<strong>"+ready+"</strong> routing-ready candidate"+(ready===1?"":"s")+" · "+c.length+" evidence-backed candidate"+(c.length===1?"":"s")+" · read-only runtime";
    list.innerHTML=c.slice(0,8).map(function(x){return'<div class="opportunity"><div class="op-icon">'+(x.allocatableQuantity>0?"↗":"⊘")+'</div><div class="op-copy"><div class="op-name">Product '+esc(x.productId)+'</div><div class="op-detail"><span class="'+(x.allocatableQuantity>0?"stock-healthy":"stock-attention")+'">'+esc(x.routeStatus==="READY"?x.routeType:"BLOCKED")+'</span> · '+(x.requestedQuantity?x.allocatableQuantity.toLocaleString()+" / "+x.requestedQuantity.toLocaleString()+" units allocatable":"Requested quantity unknown")+' · score '+x.opportunityScore+'/100</div><div class="op-detail">Inquiry '+esc(x.inquiryId)+' · relationship '+esc(x.relationshipId||"none")+'</div><div class="op-detail">'+esc(x.blockReason||"Evidence complete. Route is ready for execution handoff.")+'</div></div></div>'}).join("");
  }
  window.refreshDepletorAllocation=async function(){
    var root=document.getElementById("depletor-console"),user=null;try{user=currentUser}catch(e){}
    if(!root){return;} if(!user||String(user.role||"").toLowerCase()!=="distributor"){state.error=new Error("AUTH_CONTEXT_UNAVAILABLE");state.candidates=[];render();return;} ensurePanel();state.error=null;
    var status=document.getElementById("depletor-allocation-status"),list=document.getElementById("depletor-allocation-list");if(status)status.textContent="Validating allocation evidence…";if(list)list.innerHTML="";
    try{var r=await readEvidence();state.candidates=r.candidates||[];window.goodsbarnxAllocationCandidates=state.candidates;render();return state.candidates}catch(e){state.error=e;state.candidates=[];console.warn(VERSION+":",e);render();throw e}
  };
  document.addEventListener("DOMContentLoaded",function(){setTimeout(window.refreshDepletorAllocation,1000);setTimeout(window.refreshDepletorAllocation,2200)});
})();
