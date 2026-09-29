import assert from "node:assert/strict";
import test from "node:test";
import {refundAllowed,signedFolioAmount} from "../lib/folio.ts";
test("refund never exceeds payments after earlier refunds",()=>{
 assert.equal(refundAllowed(4000,5000),true);
 assert.equal(refundAllowed(5001,5000),false);
 assert.equal(refundAllowed(1,0),false);
 assert.equal(refundAllowed(-1,5000),false);
 assert.equal(signedFolioAmount("payment",4000),-4000);
 assert.equal(signedFolioAmount("refund",2000),2000);
 assert.throws(()=>signedFolioAmount("charge",0));
});
