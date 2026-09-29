import assert from "node:assert/strict";
import test from "node:test";
import {validHousekeepingTransition} from "../lib/housekeeping.ts";
test("housekeeping only follows the cleaning and second-review sequence",()=>{
 assert.equal(validHousekeepingTransition("todo","complete"),false);
 assert.equal(validHousekeepingTransition("todo","approve"),false);
 assert.equal(validHousekeepingTransition("todo","start"),true);
 assert.equal(validHousekeepingTransition("in_progress","complete"),true);
 assert.equal(validHousekeepingTransition("cleaned","approve"),true);
 assert.equal(validHousekeepingTransition("ready","reject"),false);
 assert.equal(validHousekeepingTransition("in_progress","report_issue"),true);
});
