"use client";
import {useEffect} from "react";
import {useRouter} from "next/navigation";

export function DashboardRefresh({label,button}:{label:string;button:string}){
 const router=useRouter();
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==="visible")router.refresh()};
  const interval=window.setInterval(refresh,60000);
  document.addEventListener("visibilitychange",refresh);
  return()=>{window.clearInterval(interval);document.removeEventListener("visibilitychange",refresh)};
 },[router]);
 return <p className="dashboardRefresh">{label} <button type="button" onClick={()=>router.refresh()}>{button}</button></p>;
}
