/* GoodsbarnX V1.8.2.6.8.1.1.2 — Allocation Evidence Integrity Boundary
   Diagnostic only. Raw evidence validation + inquiry forensic diagnosis.
   No writes, no stock mutation, no runtime changes.
*/
(function(){
  "use strict";

  var VERSION="V1.8.2.6.8.1.1.2";

  var EXPECTED={
    build:"GBX-V1.8.2.6.8.1.1.2-EVIDENCE-INTEGRITY-20260916",
    authVersion:"V1.8.2.6.6.4",
    allocationVersion:"V1.8.2.6"
  };

  var running=false,started=false,waiting=false,waitStarted=0;
  var MAX_AUTH_WAIT_MS=15000,AUTH_RETRY_MS=250;

  function el(id){return document.getElementById(id)}

  function safe(v){
    return v==null?"none":String(v)
  }

  function line(kind,name,detail){
    var mark=
      kind==="VALID"?"✓ VALID":
      kind==="INVALID"?"✗ INVALID":
      kind==="MISSING"?"⚠ MISSING":
      kind==="AMBIGUOUS"?"⚠ AMBIGUOUS":
      "? UNSUPPORTED";

    return mark+" — "+name+(detail?": "+detail:"")
  }

  function user(){
    try{
      return typeof currentUser!=="undefined"?currentUser:null
    }catch(e){
      return null
    }
  }

  function ctx(){
    return window.goodsbarnxAuthContext||null
  }

  function validId(v){
    return typeof v==="string"&&v.trim().length>0
  }

  function numeric(v){
    if(typeof v==="number")return Number.isFinite(v);

    if(
      typeof v==="string"&&
      v.trim()!==""
    ){
      return Number.isFinite(Number(v))
    }

    return false
  }

  function positiveNumeric(v){
    return numeric(v)&&Number(v)>0
  }

  function classify(condition,missing,ambiguous,unsupported){
    if(missing)return "MISSING";
    if(ambiguous)return "AMBIGUOUS";
    if(unsupported)return "UNSUPPORTED";
    return condition?"VALID":"INVALID"
  }

  function summarize(records){
    var s={
      VALID:0,
      INVALID:0,
      MISSING:0,
      AMBIGUOUS:0,
      UNSUPPORTED:0
    };

    records.forEach(function(r){
      s[r.kind]++
    });

    return s
  }

  function push(records,kind,name,detail){
    records.push({
      kind:kind,
      name:name,
      detail:detail
    });
  }

  async function run(){

    if(running||started||waiting)return;

    var panel=el("v18268-evidence-integrity"),
        status=el("v18268-test-status"),
        metrics=el("v18268-test-metrics"),
        output=el("v18268-test-output");

    try{

      if(!panel||!status||!metrics||!output)return;

      panel.classList.add("gbx-v18268-visible");

      var marker=
        document.documentElement.getAttribute("data-goodsbarnx-build")||
        (document.querySelector('meta[name="goodsbarnx-build"]')||{}).content||
        "missing";

      var c=ctx(),
          u=user(),
          checks=[];

      checks.push({
        kind:marker===EXPECTED.build?"VALID":"INVALID",
        name:"Deployment marker",
        detail:marker
      });

      checks.push({
        kind:window.goodsbarnxAuthContextVersion===EXPECTED.authVersion?"VALID":"INVALID",
        name:"Auth runtime version",
        detail:safe(window.goodsbarnxAuthContextVersion)
      });

      checks.push({
        kind:window.goodsbarnxDepletorAllocationVersion===EXPECTED.allocationVersion?"VALID":"INVALID",
        name:"Allocation runtime version",
        detail:safe(window.goodsbarnxDepletorAllocationVersion)
      });

      /*
       * Preserve the existing authentication boundary.
       * This diagnostic does not create or replace authentication state.
       */

      if(!c||c.ready!==true){

        if(!waitStarted)waitStarted=performance.now();

        status.className="gbx-v18268-status gbx-v18268-warn";

        status.textContent=
          VERSION+
          " WAITING FOR AUTH CONTEXT\n\n"+
          "Authentication resolver is still initializing. No allocation evidence evaluated.";

        output.textContent=
          "Waiting for the existing authentication boundary to resolve.\n"+
          "No database write executed.\n"+
          "No stock mutation executed.\n"+
          "Allocation runtime remains V1.8.2.6 and read-only.";

        if(performance.now()-waitStarted<MAX_AUTH_WAIT_MS){

          waiting=true;

          setTimeout(function(){
            waiting=false;
            run()
          },AUTH_RETRY_MS);

          return
        }

        started=true;
        running=true;

      }else{

        started=true;
        running=true
      }

      c=ctx();
      u=user();

      var authReady=
        !!c&&
        c.ready===true&&
        c.authenticated===true&&
        validId(c.userId)&&
        String(c.role||"").toLowerCase()==="distributor";

      var currentReady=
        !!u&&
        validId(u.id)&&
        String(u.role||"").toLowerCase()==="distributor";

      var same=
        authReady&&
        currentReady&&
        String(c.userId)===String(u.id);

      checks.push({
        kind:authReady?"VALID":"MISSING",
        name:"Authenticated distributor context",
        detail:
          authReady
            ?"ready · "+c.userId
            :(c&&c.state
              ?"context state = "+c.state
              :"context unavailable")
      });

      checks.push({
        kind:currentReady?"VALID":"MISSING",
        name:"Application currentUser distributor principal",
        detail:
          currentReady
            ?u.id
            :"currentUser unavailable"
      });

      checks.push({
        kind:same?"VALID":"INVALID",
        name:"Context identity continuity",
        detail:
          same
            ?"authContext.userId matches currentUser.id"
            :"identity mismatch"
      });

      if(!authReady||!currentReady||!same){

        status.className=
          "gbx-v18268-status gbx-v18268-warn";

        status.textContent=
          VERSION+
          " AWAITING VALID ALLOCATION CONTEXT\n\n"+
          checks.map(function(x){
            return line(x.kind,x.name,x.detail)
          }).join("\n")+
          "\n\n⚠ WAIT — Raw evidence integrity is not evaluated until the authenticated distributor boundary is valid.";

        output.textContent=
          "No allocation evidence evaluated.\n"+
          "No database write executed.\n"+
          "No stock mutation executed.\n"+
          "Allocation runtime remains V1.8.2.6 and read-only.";

        return
      }

      var id=u.id,
          queryStarted=performance.now();

      var rs=await Promise.all([

        sb
          .from("products")
          .select("id,name,price,stock_quantity,status,category,distributor_id")
          .eq("distributor_id",id),

        sb
          .from("inquiries")
          .select("id,item,quantity,status,created_at,buyer_id,distributor_id,inquirer_id")
          .eq("distributor_id",id)
          .order("created_at",{ascending:false}),

        sb
          .from("trade_relationships")
          .select("id,buyer_id,distributor_id,status,is_primary")
          .eq("distributor_id",id),

        sb
          .from("agent_distributor_attachments")
          .select("id,agent_id,distributor_id,status")
          .eq("distributor_id",id)

      ]);

      var queryMs=Math.round(performance.now()-queryStarted),
          errors=rs.map(function(r){
            return r.error||null
          });

      var records=[];

      if(errors.some(Boolean)){

        push(
          records,
          "INVALID",
          "Raw evidence query execution",
          errors.map(function(e){
            return e?e.message:"ok"
          }).join(" | ")
        );

      }else{

        push(
          records,
          "VALID",
          "Raw evidence queries",
          "4/4 read-only queries returned without error"
        );
      }

      var products=rs[0].data||[],
          inquiries=rs[1].data||[],
          rels=rs[2].data||[],
          agents=rs[3].data||[];

      function ownership(rows,label){

        var bad=rows.filter(function(r){
          return String(r.distributor_id)!==String(id)
        });

        push(
          records,
          bad.length?"INVALID":"VALID",
          label,
          bad.length
            ?bad.length+" row(s) outside authenticated distributor scope"
            :rows.length+" row(s) scoped to principal"
        );
      }

      ownership(products,"Products distributor ownership");
      ownership(inquiries,"Inquiries distributor ownership");
      ownership(rels,"Relationships distributor ownership");
      ownership(agents,"Agent attachments distributor ownership");

      /*
       * ---------------------------------------------------------------
       * PRODUCT INTEGRITY
       * ---------------------------------------------------------------
       */

      var productInvalid=0,
          productMissing=0;

      products.forEach(function(p){

        if(!validId(p.id)){
          productInvalid++
        }

        if(p.stock_quantity==null){

          productMissing++

        }else if(
          !numeric(p.stock_quantity)||
          Number(p.stock_quantity)<0
        ){

          productInvalid++
        }
      });

      push(
        records,
        productInvalid?"INVALID":"VALID",
        "Product identity + stock quantity integrity",
        productInvalid
          ?productInvalid+" invalid row/field condition(s)"
          :products.length+" product row(s) checked"
      );

      push(
        records,
        productMissing?"MISSING":"VALID",
        "Product stock quantity presence",
        productMissing
          ?productMissing+" product(s) missing stock_quantity"
          :"all product rows have stock_quantity"
      );

      /*
       * ---------------------------------------------------------------
       * INQUIRY INTEGRITY
       *
       * V1.8.2.6.8.1.1.2 CHANGE:
       *
       * Preserve the original integrity predicates, but capture the
       * exact inquiry, field, raw value and failure predicate.
       *
       * READ ONLY.
       * ---------------------------------------------------------------
       */

      var inquiryInvalid=0,
          inquiryMissing=0,
          inquiryAmbiguous=0,
          inquiryUnsupported=0,
          inquiryForensics=[];

      inquiries.forEach(function(i){

        var failures=[];

        /*
         * Inquiry identity
         */

        if(!validId(i.id)){

          inquiryInvalid++;

          failures.push({
            field:"id",
            predicate:"validId(i.id)",
            raw_value:i.id,
            normalized_value:safe(i.id),
            reason:"inquiry id is missing or invalid"
          });
        }

        /*
         * Inquiry quantity
         *
         * quantity remains treated as a potentially TEXT field.
         * No SQL numeric comparison is introduced.
         */

        if(
          i.quantity==null||
          String(i.quantity).trim()===""
        ){

          inquiryMissing++;

          failures.push({
            field:"quantity",
            predicate:"quantity presence",
            raw_value:i.quantity,
            normalized_value:"",
            reason:"quantity is missing or empty",
            classification:"MISSING"
          });

        }else if(!numeric(i.quantity)){

          inquiryInvalid++;

          failures.push({
            field:"quantity",
            predicate:"numeric(quantity)",
            raw_value:i.quantity,
            normalized_value:String(i.quantity).trim(),
            reason:"quantity is not numeric"
          });

        }else if(Number(i.quantity)<=0){

          inquiryInvalid++;

          failures.push({
            field:"quantity",
            predicate:"Number(quantity) > 0",
            raw_value:i.quantity,
            normalized_value:Number(i.quantity),
            reason:"quantity must be greater than zero"
          });
        }

        /*
         * Status
         */

        var st=String(i.status||"").trim().toLowerCase();

        if(!st){

          inquiryMissing++;

          failures.push({
            field:"status",
            predicate:"status presence",
            raw_value:i.status,
            normalized_value:"",
            reason:"status is missing or empty",
            classification:"MISSING"
          });

        }else if(
          ["open","pending","closed","resolved","completed"].indexOf(st)===-1
        ){

          inquiryUnsupported++;

          failures.push({
            field:"status",
            predicate:"supported inquiry status",
            raw_value:i.status,
            normalized_value:st,
            reason:"status is outside the supported schema set",
            classification:"UNSUPPORTED"
          });
        }

        /*
         * Buyer attribution coherence
         */

        if(
          i.buyer_id!=null&&
          i.inquirer_id!=null&&
          String(i.buyer_id)!==String(i.inquirer_id)
        ){

          inquiryAmbiguous++;

          failures.push({
            field:"buyer_id/inquirer_id",
            predicate:"buyer_id === inquirer_id",
            raw_value:
              "buyer_id="+safe(i.buyer_id)+
              " | inquirer_id="+safe(i.inquirer_id),
            normalized_value:
              String(i.buyer_id)+" !== "+String(i.inquirer_id),
            reason:"buyer attribution fields conflict",
            classification:"AMBIGUOUS"
          });
        }

        /*
         * Capture only inquiries with a forensic condition.
         */

        if(failures.length){

          inquiryForensics.push({
            inquiry_id:i.id,
            item:i.item,
            buyer_id:i.buyer_id,
            inquirer_id:i.inquirer_id,
            product_id:i.product_id,
            quantity:i.quantity,
            status:i.status,
            failures:failures
          });
        }
      });

      push(
        records,
        inquiryInvalid?"INVALID":"VALID",
        "Inquiry identity + quantity integrity",
        inquiryInvalid
          ?inquiryInvalid+" invalid condition(s)"
          :inquiries.length+" inquiry row(s) checked"
      );

      push(
        records,
        inquiryMissing?"MISSING":"VALID",
        "Inquiry required quantity/status presence",
        inquiryMissing
          ?inquiryMissing+" missing required field condition(s)"
          :"quantity and status present where required"
      );

      push(
        records,
        inquiryUnsupported?"UNSUPPORTED":"VALID",
        "Inquiry status support",
        inquiryUnsupported
          ?inquiryUnsupported+" unsupported status condition(s)"
          :"all statuses are schema-supported; terminal statuses remain non-actionable"
      );

      push(
        records,
        inquiryAmbiguous?"AMBIGUOUS":"VALID",
        "Buyer attribution coherence",
        inquiryAmbiguous
          ?inquiryAmbiguous+" inquiry(s) have conflicting buyer_id/inquirer_id"
          :"no conflicting buyer_id/inquirer_id pair detected"
      );

      /*
       * ---------------------------------------------------------------
       * RELATIONSHIP INTEGRITY
       * ---------------------------------------------------------------
       */

      var relInvalid=0,
          relMissing=0;

      rels.forEach(function(r){

        if(
          !validId(r.id)||
          !validId(r.buyer_id)
        ){
          relMissing++
        }

        var st=String(r.status||"").trim().toLowerCase();

        if(!st){

          relMissing++

        }else if(
          ["active","pending","paused","released","terminated"].indexOf(st)===-1
        ){

          relInvalid++
        }

        if(typeof r.is_primary!=="boolean"){
          relInvalid++
        }
      });

      push(
        records,
        relMissing?"MISSING":"VALID",
        "Relationship identity + required fields",
        relMissing
          ?relMissing+" missing relationship field condition(s)"
          :rels.length+" relationship row(s) checked"
      );

      push(
        records,
        relInvalid?"UNSUPPORTED":"VALID",
        "Relationship status/primary-state support",
        relInvalid
          ?relInvalid+" unsupported or malformed relationship condition(s)"
          :"status and is_primary are explicit"
      );

      /*
       * ---------------------------------------------------------------
       * AGENT ATTACHMENT INTEGRITY
       * ---------------------------------------------------------------
       */

      var agentInvalid=0,
          agentMissing=0,
          acceptedAgents=0;

      agents.forEach(function(a){

        if(
          !validId(a.id)||
          !validId(a.agent_id)
        ){
          agentMissing++
        }

        var st=String(a.status||"").trim().toLowerCase();

        if(!st){

          agentMissing++

        }else if(
          ["pending","accepted","rejected","paused","terminated"].indexOf(st)===-1
        ){

          agentInvalid++
        }

        if(st==="accepted"){
          acceptedAgents++
        }
      });

      push(
        records,
        agentMissing?"MISSING":"VALID",
        "Accepted-agent identity fields",
        agentMissing
          ?agentMissing+" missing identity condition(s)"
          :agents.length+" attachment row(s) checked"
      );

      push(
        records,
        agentInvalid?"UNSUPPORTED":"VALID",
        "Agent attachment status",
        agentInvalid
          ?agentInvalid+" unsupported status condition(s)"
          :"statuses are explicit; accepted capacity="+acceptedAgents
      );

      /*
       * ---------------------------------------------------------------
       * FORENSIC SUMMARY
       * ---------------------------------------------------------------
       */

      var summary=summarize(records),
          hardFail=
            summary.INVALID>0||
            summary.AMBIGUOUS>0||
            summary.UNSUPPORTED>0;

      metrics.innerHTML=
        '<div class="gbx-v18268-grid">'+
          '<div><strong>'+products.length+'</strong><span>PRODUCTS</span></div>'+
          '<div><strong>'+inquiries.length+'</strong><span>INQUIRIES</span></div>'+
          '<div><strong>'+rels.length+'</strong><span>RELATIONSHIPS</span></div>'+
          '<div><strong>'+agents.length+'</strong><span>AGENT ATTACHMENTS</span></div>'+
        '</div>'+
        '<div class="gbx-v18268-summary">'+
          '<b>VALID '+summary.VALID+'</b> · '+
          '<b>INVALID '+summary.INVALID+'</b> · '+
          '<b>MISSING '+summary.MISSING+'</b> · '+
          '<b>AMBIGUOUS '+summary.AMBIGUOUS+'</b> · '+
          '<b>UNSUPPORTED '+summary.UNSUPPORTED+'</b>'+
        '</div>';

      status.className=
        "gbx-v18268-status "+
        (hardFail
          ?"gbx-v18268-fail"
          :"gbx-v18268-pass");

      status.textContent=
        (
          hardFail
            ?VERSION+" EVIDENCE INTEGRITY BLOCKED"
            :VERSION+" EVIDENCE INTEGRITY PASSED"
        )+
        "\n\n"+
        records.map(function(x){
          return line(x.kind,x.name,x.detail)
        }).join("\n");

      /*
       * ---------------------------------------------------------------
       * FORENSIC OUTPUT
       * ---------------------------------------------------------------
       */

      var forensicText="";

      if(inquiryForensics.length===0){

        forensicText=
          "INQUIRY FORENSIC\n\n"+
          "✓ No inquiry identity/quantity forensic failure captured.\n";

      }else{

        forensicText=
          "INQUIRY FORENSIC\n\n"+
          inquiryForensics.map(function(f,index){

            return(
              "INVALID INQUIRY #"+(index+1)+"\n"+
              "inquiry_id="+safe(f.inquiry_id)+"\n"+
              "item="+safe(f.item)+"\n"+
              "buyer_id="+safe(f.buyer_id)+"\n"+
              "inquirer_id="+safe(f.inquirer_id)+"\n"+
              "product_id="+safe(f.product_id)+"\n"+
              "quantity="+safe(f.quantity)+"\n"+
              "status="+safe(f.status)+"\n"+
              "\nFAILURE(S)\n"+
              f.failures.map(function(failure){

                return(
                  "field="+safe(failure.field)+"\n"+
                  "predicate="+safe(failure.predicate)+"\n"+
                  "raw_value="+safe(failure.raw_value)+"\n"+
                  "normalized_value="+safe(failure.normalized_value)+"\n"+
                  "reason="+safe(failure.reason)+
                  (failure.classification
                    ?"\nclassification="+failure.classification
                    :"")
                );

              }).join("\n\n")+
              "\n\n----------------------------------------\n"
            );

          }).join("\n");
      }

      output.textContent=
        "ALLOCATION EVIDENCE INTEGRITY TRACE\n\n"+
        "Page URL: "+location.href+"\n"+
        "Build marker: "+marker+"\n"+
        "Auth runtime: "+safe(window.goodsbarnxAuthContextVersion)+"\n"+
        "Allocation runtime: "+safe(window.goodsbarnxDepletorAllocationVersion)+"\n\n"+
        "RAW EVIDENCE\n"+
        "products="+products.length+"\n"+
        "inquiries="+inquiries.length+"\n"+
        "trade_relationships="+rels.length+"\n"+
        "agent_distributor_attachments="+agents.length+"\n"+
        "query_time_ms="+queryMs+"\n\n"+
        "CLASSIFICATION\n"+
        "VALID="+summary.VALID+"\n"+
        "INVALID="+summary.INVALID+"\n"+
        "MISSING="+summary.MISSING+"\n"+
        "AMBIGUOUS="+summary.AMBIGUOUS+"\n"+
        "UNSUPPORTED="+summary.UNSUPPORTED+"\n\n"+
        forensicText+
        "\n"+
        "No data repaired.\n"+
        "No database write executed.\n"+
        "No stock mutation executed.\n"+
        "No relationship activated.\n"+
        "No order created.\n"+
        "Allocation runtime remains V1.8.2.6 and read-only.";

    }catch(e){

      status.className=
        "gbx-v18268-status gbx-v18268-fail";

      status.textContent=
        VERSION+
        " EVIDENCE INTEGRITY FAILED\n\n"+
        "✗ INVALID — Diagnostic execution exception: "+
        safe(e&&e.message||e);

      output.textContent=
        "No evidence repaired.\n"+
        "No database write executed.\n"+
        "No stock mutation executed.";
    }

    finally{
      running=false
    }
  }

  document.addEventListener(
    "DOMContentLoaded",
    function(){
      setTimeout(run,400)
    }
  );

  window.addEventListener(
    "load",
    function(){
      setTimeout(run,400)
    }
  );

})();
