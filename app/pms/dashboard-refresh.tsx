"use client";
import {useEffect} from "react";
import {useRouter} from "next/navigation";

export function DashboardRefresh(){
 const router=useRouter();
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==="visible")router.refresh()};
  const interval=window.setInterval(refresh,60000);
  document.addEventListener("visibilitychange",refresh);
  return()=>{window.clearInterval(interval);document.removeEventListener("visibilitychange",refresh)};
 },[router]);
 return <p className="dashboardRefresh">Η εικόνα ανανεώνεται αυτόματα κάθε λεπτό. <button type="button" onClick={()=>router.refresh()}>Ανανέωση τώρα</button></p>;
}
