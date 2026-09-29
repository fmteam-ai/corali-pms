import fs from "node:fs";
export function databaseSsl(){if(process.env.DATABASE_SSL!=="true")return false;const caPath=process.env.DATABASE_SSL_CA?.trim();return{rejectUnauthorized:true,...(caPath?{ca:fs.readFileSync(caPath,"utf8")}:{})}}
