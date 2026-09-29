import assert from "node:assert/strict";
import test from "node:test";
import { priceForRooms,priceForRoomTotals } from "../lib/room-pricing.ts";
test("direct room price covers every selected room",()=>{
  assert.equal(priceForRooms(10000,1,-5),9500);
  assert.equal(priceForRooms(10000,2,-5),19000);
  assert.equal(priceForRooms(10000,3,0),30000);
});
test("multi-room checkout sums actual room prices and room-specific offers",()=>{
  assert.equal(priceForRoomTotals([10000,12000],-5),20900);
  assert.equal(priceForRoomTotals([8000,12000],0),20000);
  assert.throws(()=>priceForRoomTotals([-1,12000],0));
});
