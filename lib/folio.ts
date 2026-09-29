export type FolioEntryType="charge"|"payment"|"refund"|"adjustment";
export function signedFolioAmount(type:FolioEntryType,amountCents:number):number{
 if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw Error("INVALID_AMOUNT");
 return type==="payment"?-amountCents:amountCents;
}
export function refundAllowed(amountCents:number,netPaidCents:number):boolean{
 return Number.isSafeInteger(amountCents)&&amountCents>0&&Number.isSafeInteger(netPaidCents)&&netPaidCents>=amountCents;
}
