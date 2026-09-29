export function assertBalanceCheckout(amount:number,balance:number,linkStatus:string,owner:string,expectedOwner:string){
 if(owner!==expectedOwner||linkStatus!=="checkout_pending"||!Number.isSafeInteger(amount)||amount<=0||amount!==balance)throw new Error("BALANCE_PAYMENT_MISMATCH");
}
