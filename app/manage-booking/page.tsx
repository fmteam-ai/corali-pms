import type{Metadata,Viewport}from"next";import{ManageBooking}from"./manage-booking";
// "My booking" can be added to the phone's home screen (guest app with notifications).
export const metadata:Metadata={title:"Hotel Corali · My booking",manifest:"/guest.webmanifest",appleWebApp:{capable:true,title:"Hotel Corali",statusBarStyle:"default"},icons:{apple:"/guest-apple-touch-icon.png"}};
export const viewport:Viewport={themeColor:"#173e47"};
export default async function Page({searchParams}:{searchParams:Promise<{token?:string}>}){return <ManageBooking token={(await searchParams).token??""}/>}
