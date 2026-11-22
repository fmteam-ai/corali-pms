export declare const OPEN_TASK_STATUSES: string[];
export declare const ROOM_READY_SQL: string;
export declare const SAME_DAY_RULE_OFF_SQL: string;
export declare function sellableForArrival(dateSql: string, todaySql: string): string;
export declare function roomReady(room: { operationalStatus: string; openTaskStatus?: string | null }): boolean;
export declare function sellableToday(room: { operationalStatus: string; openTaskStatus?: string | null }, arrival: string, today: string, ruleOn?: boolean): boolean;
