import {CheckinForm} from "./form";
export default async function CheckinPage({searchParams}:{searchParams:Promise<{token?:string}>}){return <CheckinForm token={(await searchParams).token??""}/>}
