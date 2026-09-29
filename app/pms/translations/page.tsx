import {requireUser} from "@/lib/auth";
import {TranslationEditor} from "./translation-editor";
export default async function TranslationsPage(){await requireUser("dashboard.read");return <><h1>Μεταφράσεις Booking</h1><p>Ονόματα και περιγραφές για τις έξι γλώσσες. Τα κενά πεδία χρησιμοποιούν το αγγλικό ή ελληνικό κείμενο.</p><TranslationEditor/></>}
