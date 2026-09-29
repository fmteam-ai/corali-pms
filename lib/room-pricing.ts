export function priceForRooms(oneRoomCents:number,rooms:number,adjustmentPercent:number){
  if(!Number.isSafeInteger(oneRoomCents)||oneRoomCents<0||!Number.isSafeInteger(rooms)||rooms<1||rooms>20||!Number.isFinite(adjustmentPercent))throw new Error("INVALID_ROOM_PRICE");
  return Math.round(oneRoomCents*rooms*(100+adjustmentPercent)/100);
}

export function priceForRoomTotals(roomTotalsCents:number[],adjustmentPercent:number){
 if(!roomTotalsCents.length||roomTotalsCents.length>20||roomTotalsCents.some(v=>!Number.isSafeInteger(v)||v<0)||!Number.isFinite(adjustmentPercent))throw new Error("INVALID_ROOM_PRICE");
 const sum=roomTotalsCents.reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(sum))throw new Error("INVALID_ROOM_PRICE");
 const result=Math.round(sum*(100+adjustmentPercent)/100);
 if(!Number.isSafeInteger(result)||result<0)throw new Error("INVALID_ROOM_PRICE");
 return result;
}
