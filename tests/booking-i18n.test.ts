import {test} from "node:test";
import assert from "node:assert/strict";
import {bookingLanguages,bookingLocale,bookingText,bookingLanguage,rateNames} from "../lib/booking-i18n.ts";
import {guestText} from "../lib/guest-i18n.ts";
import {countryCodes} from "../lib/country-codes.ts";
test("booking has complete labels and localized rates in six languages",()=>{
 const keys=Object.keys(bookingText.en).sort();assert.equal(bookingLanguages.length,6);
 for(const language of bookingLanguages){assert.deepEqual(Object.keys(bookingText[language]).sort(),keys);assert.ok(Object.values(bookingText[language]).every(value=>value.trim().length>0));assert.ok(rateNames[language].direct_web);assert.ok(new Intl.DateTimeFormat(bookingLocale[language],{month:"long"}).format(new Date(2026,0,1)));assert.ok(new Intl.DisplayNames([bookingLocale[language]],{type:"region"}).of("GR"))}
 assert.equal(bookingLanguage("fr-FR"),"fr");assert.equal(bookingLanguage("invalid"),"en");assert.ok(countryCodes.length>=240);assert.ok(countryCodes.includes("GR"));
});

test("check-in and manage booking have complete six-language labels",()=>{const fields=Object.keys(guestText.en).sort();for(const language of bookingLanguages){assert.deepEqual(Object.keys(guestText[language]).sort(),fields);assert.ok(Object.values(guestText[language]).every(value=>value.trim().length>0))}});
