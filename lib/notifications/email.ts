import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { providerCredentials } from "@/lib/provider-connections";

async function emailSettings(){
  const e=env();
  const configured=await providerCredentials(e.PMS_OWNER_ID,"smtp");
  if(configured){if(!configured.active)return null;const {host,port,username,from}=configured.settings,password=configured.secrets.password;
    return host&&username&&from&&password?{host,port:Number(port||587),username,from,password}:null;
  }
  return e.SMTP_HOST&&e.SMTP_USERNAME&&e.SMTP_PASSWORD&&e.SMTP_FROM?{host:e.SMTP_HOST,port:e.SMTP_PORT,username:e.SMTP_USERNAME,from:e.SMTP_FROM,password:e.SMTP_PASSWORD}:null;
}
export async function emailConfigured(){return Boolean(await emailSettings())}
export async function sendEmail(to:string,subject:string,text:string){const settings=await emailSettings();if(!settings)throw Error("EMAIL_NOT_CONFIGURED");const transport=nodemailer.createTransport({host:settings.host,port:settings.port,secure:settings.port===465,auth:{user:settings.username,pass:settings.password},connectionTimeout:10_000,greetingTimeout:10_000,socketTimeout:20_000});await transport.sendMail({from:settings.from,to,subject,text})}
