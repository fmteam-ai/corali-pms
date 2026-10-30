import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { providerCredentials } from "@/lib/provider-connections";
import { brandedHtml } from "@/lib/message-brand";

async function emailSettings(){
  const e=env();
  const configured=await providerCredentials(e.PMS_OWNER_ID,"smtp");
  if(configured){if(!configured.active)return null;const {host,port,username,from}=configured.settings,password=configured.secrets.password;
    return host&&username&&from&&password?{host,port:Number(port||587),username,from,password}:null;
  }
  return e.SMTP_HOST&&e.SMTP_USERNAME&&e.SMTP_PASSWORD&&e.SMTP_FROM?{host:e.SMTP_HOST,port:e.SMTP_PORT,username:e.SMTP_USERNAME,from:e.SMTP_FROM,password:e.SMTP_PASSWORD}:null;
}
export async function emailConfigured(){return Boolean(await emailSettings())}
/**
 * Guest e-mails go out as the hotel's designed template (logo, button, contact details) unless the caller gives its own
 * HTML; notices to the hotel itself ("[Corali PMS] …") and `plain: true` stay plain text.
 */
export async function sendEmail(to:string,subject:string,text:string,options:{html?:string;headers?:Record<string,string>;lang?:string;plain?:boolean}={}){const {lang,plain,...extra}=options;const settings=await emailSettings();if(!settings)throw Error("EMAIL_NOT_CONFIGURED");if(!extra.html&&!plain&&!subject.startsWith("[Corali PMS]"))extra.html=await brandedHtml(env().PMS_OWNER_ID,subject,text,lang).catch(()=>undefined);const transport=nodemailer.createTransport({host:settings.host,port:settings.port,secure:settings.port===465,auth:{user:settings.username,pass:settings.password},connectionTimeout:10_000,greetingTimeout:10_000,socketTimeout:20_000});await transport.sendMail({from:settings.from,to,subject,text,...extra})}
