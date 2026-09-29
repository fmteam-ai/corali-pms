import{ManageBooking}from"./manage-booking";export default async function Page({searchParams}:{searchParams:Promise<{token?:string}>}){return <ManageBooking token={(await searchParams).token??""}/>}
