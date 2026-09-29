import {PaymentBalance} from "./payment-balance";
export default async function Page({searchParams}:{searchParams:Promise<{token?:string;status?:string;lang?:string}>}){const p=await searchParams;return <PaymentBalance token={p.token??""} status={p.status??""} initialLanguage={p.lang??"en"}/>}
