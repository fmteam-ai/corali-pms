export const housekeepingChecklist=["Κρεβάτι και λευκά είδη","Μπάνιο","Βρύσες","Καζανάκι","Λάμπες","Ντους","Πετσέτες","Παροχές μπάνιου","Δάπεδο","Μπαλκόνι","Ψυγείο","Βραστήρας και φλιτζάνια","Καφετιέρα","Τηλεόραση","Κλιματισμός","Φωτισμός","Χρηματοκιβώτιο","Wi-Fi/QR οδηγού","Τελικός έλεγχος"] as const;
export function validChecklist(v:unknown):v is Record<string,boolean>{return!!v&&typeof v==="object"&&!Array.isArray(v)&&housekeepingChecklist.every(i=>(v as Record<string,unknown>)[i]===true)}
export type HousekeepingAction="start"|"complete"|"approve"|"reject"|"report_issue";
export function validHousekeepingTransition(status:string,action:HousekeepingAction){
 return action==="start"?status==="todo":action==="complete"?status==="in_progress":action==="approve"||action==="reject"?status==="cleaned":status==="todo"||status==="in_progress";
}
