/* ========================================================================
   GoodsbarnX — V1.8.2.6.8.1.1.16
   Execution Transaction Integrity — PRE-FLIGHT CONTRACT

   Purpose:
   Establish the read-only execution-intent boundary immediately before a
   future atomic depletion transaction. This module performs NO commerce
   mutation. It is intentionally independent of Supabase writes so the next
   transaction build can bind one server-authoritative RPC to this contract.
   ======================================================================== */
(function(){
  "use strict";

  var VERSION="V1.8.2.6.8.1.1.16";
  var ROUTE="DIRECT_BUYER";
  var HANDOFF_STATUS="READY_FOR_EXECUTION";
  var TERMINAL=["closed","resolved","completed"];
  var BAD_EVIDENCE=["invalid","ambiguous","unsupported","missing"];

  function text(v){return String(v==null?"":v).trim()}
  function id(v){return text(v).length>0}
  function positive(v){return Number.isFinite(Number(v))&&Number(v)>0}
  function lower(v){return text(v).toLowerCase()}
  function terminal(v){return TERMINAL.indexOf(lower(v))!==-1}
  function evidenceValid(c){
    var d=c&&c.evidence?lower(c.evidence.demand):"";
    return BAD_EVIDENCE.indexOf(d)===-1;
  }

  function stableKey(c){
    return [
      VERSION,
      text(c&&c.inquiryId),
      text(c&&c.productId),
      text(c&&c.buyerId),
      text(c&&c.distributorId),
      text(c&&c.relationshipId)
    ].join("|");
  }

  function preflight(candidate,principal){
    var c=candidate||{};
    var reasons=[];
    var p=text(principal);

    if(!id(c.inquiryId))reasons.push("inquiry identity missing");
    if(terminal(c.inquiryStatus))reasons.push("terminal inquiry");
    if(!evidenceValid(c))reasons.push("demand evidence not executable");
    if(!id(c.productId))reasons.push("product identity missing");
    if(!id(p)||c.distributorId!==p)reasons.push("distributor ownership mismatch");
    if(!id(c.buyerId))reasons.push("buyer identity missing");
    if(!id(c.relationshipId))reasons.push("canonical relationship identity missing");
    if(!positive(c.requestedQuantity))reasons.push("requested quantity invalid");
    if(!positive(c.availableQuantity))reasons.push("available stock invalid");
    if(!positive(c.allocatableQuantity))reasons.push("allocatable quantity invalid");
    if(positive(c.allocatableQuantity)&&positive(c.requestedQuantity)&&Number(c.allocatableQuantity)>Number(c.requestedQuantity))reasons.push("allocatable exceeds requested");
    if(positive(c.allocatableQuantity)&&positive(c.availableQuantity)&&Number(c.allocatableQuantity)>Number(c.availableQuantity))reasons.push("allocatable exceeds available stock");
    if(lower(c.routeStatus)!==lower("READY"))reasons.push("candidate is not READY");
    if(lower(c.routeType)!==lower(ROUTE))reasons.push("candidate route is not DIRECT_BUYER");

    return {
      version:VERSION,
      eligible:reasons.length===0,
      status:reasons.length===0?HANDOFF_STATUS:"BLOCKED",
      routeType:ROUTE,
      reasons:reasons,
      idempotencyKey:stableKey(c)
    };
  }

  function buildIntent(candidate,principal){
    var c=candidate||{};
    var gate=preflight(c,principal);
    if(!gate.eligible)return {ok:false,gate:gate,intent:null};
    return {
      ok:true,
      gate:gate,
      intent:{
        intentVersion:VERSION,
        handoffStatus:HANDOFF_STATUS,
        inquiryId:c.inquiryId,
        productId:c.productId,
        buyerId:c.buyerId,
        distributorId:c.distributorId,
        relationshipId:c.relationshipId,
        routeType:ROUTE,
        requestedQuantity:Number(c.requestedQuantity),
        allocatableQuantity:Number(c.allocatableQuantity),
        expectedAvailableQuantity:Number(c.availableQuantity),
        stockBasis:"candidate.availableQuantity",
        idempotencyKey:gate.idempotencyKey,
        mutationAllowed:false
      }
    };
  }

  window.gbxDepletionTransaction={
    version:VERSION,
    routeType:ROUTE,
    handoffStatus:HANDOFF_STATUS,
    preflight:preflight,
    buildIntent:buildIntent,
    stableKey:stableKey
  };
})();
