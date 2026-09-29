import process from "node:process";
import pg from "pg";
import { hash } from "@node-rs/argon2";
import { databaseSsl } from "./database-config.mjs";

const [username, displayName, email, commandPassword] = process.argv.slice(2);
const password=process.env.PMS_ADMIN_PASSWORD??commandPassword;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!username || !displayName || !email || !password || password.length < 14) {
  console.error("Usage: set PMS_ADMIN_PASSWORD securely or pass PASSWORD(min 14 chars)"); process.exit(1);
}
const ownerId=process.env.PMS_OWNER_ID??"hotel-corali", now=Date.now();
const passwordHash=await hash(password,{algorithm:2,memoryCost:65536,timeCost:3,parallelism:4,outputLen:32});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:databaseSsl()});
try{await pool.query(`INSERT INTO pms_staff_users(owner_id,username,display_name,email,password_hash,totp_secret,permissions_json,role,active,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'','{}','owner',1,$6,$6) ON CONFLICT(owner_id,username) DO UPDATE SET display_name=$3,email=$4,password_hash=$5,role='owner',active=1,updated_at=$6`,[ownerId,username.toLowerCase(),displayName,email,passwordHash,now]);console.log("PMS owner account created or updated.")}finally{await pool.end()}
