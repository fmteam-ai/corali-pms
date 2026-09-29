export declare const events:readonly string[];
export declare function greekTime(date:string,offsetDays:number,hour:number):number;
export declare function scheduleFor(event:string,booking:{check_in:string;check_out:string;created_at:number},settings:{review_days_after_checkout:number;send_hour:number;checkin_days_before?:number;balance_days_before_checkout?:number}):number;
export declare function interpolate(text:string,values:Record<string,string>):string;
export declare function eligible(event:string,booking:{status:string;check_in:string;check_out:string;balance_cents:number;checkin_submitted?:boolean},now:Date):boolean;
