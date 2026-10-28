// "My booking" → Near the hotel: texts and category names in the 6 guest languages.
import type { NearbyKind } from "@/lib/tv-nearby-core";

type L = "el" | "en" | "fr" | "de" | "it" | "es";
type T = { title: string; subtitle: string; all: string; walk: string; drive: string; today: string; closed: string; call: string; website: string; map: string; directions: string; close: string; none: string; source: string; reviews: string };

export const nearbyTexts: Record<L, T> = {
  el: { title: "📍 Κοντά στο ξενοδοχείο", subtitle: "Καταστήματα και υπηρεσίες σε ακτίνα {km} χλμ. από το Hotel Corali.", all: "Όλα", walk: "{m} · {min}΄ με τα πόδια", drive: "{m} · περ. {min}΄ με αυτοκίνητο", today: "Σήμερα", closed: "Κλειστά", call: "Κλήση", website: "Ιστοσελίδα", map: "Χάρτης", directions: "Οδηγίες", close: "Κλείσιμο", none: "Δεν βρέθηκαν μέρη σε αυτή την κατηγορία.", source: "Πηγή", reviews: "κριτικές" },
  en: { title: "📍 Near the hotel", subtitle: "Shops and services within {km} km of Hotel Corali.", all: "All", walk: "{m} · {min} min walk", drive: "{m} · ~{min} min by car", today: "Today", closed: "Closed", call: "Call", website: "Website", map: "Map", directions: "Directions", close: "Close", none: "No places in this category.", source: "Source", reviews: "reviews" },
  fr: { title: "📍 Près de l'hôtel", subtitle: "Commerces et services à {km} km de l'Hotel Corali.", all: "Tout", walk: "{m} · {min} min à pied", drive: "{m} · ~{min} min en voiture", today: "Aujourd'hui", closed: "Fermé", call: "Appeler", website: "Site web", map: "Carte", directions: "Itinéraire", close: "Fermer", none: "Aucun lieu dans cette catégorie.", source: "Source", reviews: "avis" },
  de: { title: "📍 In der Nähe des Hotels", subtitle: "Geschäfte und Dienstleistungen im Umkreis von {km} km um das Hotel Corali.", all: "Alle", walk: "{m} · {min} Min. zu Fuß", drive: "{m} · ca. {min} Min. mit dem Auto", today: "Heute", closed: "Geschlossen", call: "Anrufen", website: "Website", map: "Karte", directions: "Route", close: "Schließen", none: "Keine Orte in dieser Kategorie.", source: "Quelle", reviews: "Bewertungen" },
  it: { title: "📍 Vicino all'hotel", subtitle: "Negozi e servizi entro {km} km dall'Hotel Corali.", all: "Tutti", walk: "{m} · {min} min a piedi", drive: "{m} · ~{min} min in auto", today: "Oggi", closed: "Chiuso", call: "Chiama", website: "Sito web", map: "Mappa", directions: "Indicazioni", close: "Chiudi", none: "Nessun luogo in questa categoria.", source: "Fonte", reviews: "recensioni" },
  es: { title: "📍 Cerca del hotel", subtitle: "Tiendas y servicios a {km} km del Hotel Corali.", all: "Todo", walk: "{m} · {min} min a pie", drive: "{m} · ~{min} min en coche", today: "Hoy", closed: "Cerrado", call: "Llamar", website: "Web", map: "Mapa", directions: "Cómo llegar", close: "Cerrar", none: "No hay lugares en esta categoría.", source: "Fuente", reviews: "reseñas" },
};

export const nearbyKinds: Record<NearbyKind, { icon: string } & Record<L, string>> = {
  restaurant: { icon: "🍽️", el: "Εστιατόρια", en: "Restaurants", fr: "Restaurants", de: "Restaurants", it: "Ristoranti", es: "Restaurantes" },
  cafe: { icon: "☕", el: "Καφέ", en: "Cafés", fr: "Cafés", de: "Cafés", it: "Caffè", es: "Cafeterías" },
  bar: { icon: "🍹", el: "Μπαρ", en: "Bars", fr: "Bars", de: "Bars", it: "Bar", es: "Bares" },
  fast_food: { icon: "🥙", el: "Σουβλάκι / fast food", en: "Souvlaki / fast food", fr: "Snack / fast-food", de: "Imbiss / Fast Food", it: "Fast food", es: "Comida rápida" },
  ice_cream: { icon: "🍦", el: "Παγωτό", en: "Ice cream", fr: "Glaces", de: "Eis", it: "Gelato", es: "Helados" },
  bakery: { icon: "🥐", el: "Φούρνοι / ζαχαροπλαστεία", en: "Bakeries / pastry", fr: "Boulangeries / pâtisseries", de: "Bäckereien / Konditoreien", it: "Panetterie / pasticcerie", es: "Panaderías / pastelerías" },
  supermarket: { icon: "🛒", el: "Σούπερ μάρκετ / mini market", en: "Supermarkets / mini markets", fr: "Supermarchés / épiceries", de: "Supermärkte / Minimärkte", it: "Supermercati / minimarket", es: "Supermercados / tiendas" },
  pharmacy: { icon: "💊", el: "Φαρμακεία", en: "Pharmacies", fr: "Pharmacies", de: "Apotheken", it: "Farmacie", es: "Farmacias" },
  health: { icon: "🩺", el: "Γιατροί / υγεία", en: "Doctors / health", fr: "Médecins / santé", de: "Ärzte / Gesundheit", it: "Medici / salute", es: "Médicos / salud" },
  atm: { icon: "🏧", el: "ATM / τράπεζες", en: "ATM / banks", fr: "DAB / banques", de: "Geldautomaten / Banken", it: "Bancomat / banche", es: "Cajeros / bancos" },
  shop: { icon: "🛍️", el: "Καταστήματα", en: "Shops", fr: "Boutiques", de: "Geschäfte", it: "Negozi", es: "Tiendas" },
  beauty: { icon: "💇", el: "Κομμωτήρια / ομορφιά", en: "Hair / beauty", fr: "Coiffure / beauté", de: "Friseur / Beauty", it: "Parrucchieri / bellezza", es: "Peluquería / belleza" },
  car_rental: { icon: "🚗", el: "Ενοικιάσεις οχημάτων", en: "Car / bike rental", fr: "Location de véhicules", de: "Auto- / Rollervermietung", it: "Noleggio auto / moto", es: "Alquiler de vehículos" },
  fuel: { icon: "⛽", el: "Βενζινάδικα", en: "Petrol stations", fr: "Stations-service", de: "Tankstellen", it: "Distributori", es: "Gasolineras" },
  laundry: { icon: "🧺", el: "Πλυντήρια", en: "Laundry", fr: "Laverie", de: "Wäscherei", it: "Lavanderia", es: "Lavandería" },
  travel: { icon: "🎫", el: "Πρακτορεία / εισιτήρια", en: "Travel agencies / tickets", fr: "Agences / billets", de: "Reisebüros / Tickets", it: "Agenzie / biglietti", es: "Agencias / billetes" },
  sight: { icon: "🏛️", el: "Αξιοθέατα", en: "Sights", fr: "À voir", de: "Sehenswertes", it: "Da vedere", es: "Lugares de interés" },
};
