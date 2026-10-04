/* Hotel Corali AI assistant for the hotel website (hotelcorali.gr).
 * Add before </body>:
 *   <script src="https://booking.hotelcorali.gr/assistant-widget.js" defer></script>
 * Optional: data-language="el|en|fr|de|it|es|auto", data-color="#b64b31", data-position="right|left".
 * It answers questions with the same assistant as the booking form (hotel facts, rooms, extras, policy) and links to
 * the booking page. It cannot book or change anything. */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || window.__coraliAssistant) return;
  window.__coraliAssistant = true;
  var origin;
  try { origin = new URL(script.src).origin; } catch { return; }
  var configured = (script.dataset.language || "auto").toLowerCase();
  var lang = (configured === "auto" ? (document.documentElement.lang || navigator.language || "en") : configured).slice(0, 2).toLowerCase();
  if (["en", "el", "fr", "de", "it", "es"].indexOf(lang) < 0) lang = "en";
  var color = /^#[0-9a-f]{6}$/i.test(script.dataset.color || "") ? script.dataset.color : "#b64b31";
  var side = script.dataset.position === "left" ? "left" : "right";
  var T = {
    en: { open: "Questions? Ask us", title: "Hotel Corali assistant", intro: "Hi! Ask me about our rooms, prices, the area, arrival or our policies.", placeholder: "Type your question…", send: "Send", book: "Check availability & book", error: "Sorry, I can't answer right now. Please try again or email us.", note: "Automated assistant – answers may contain mistakes.", close: "Close" },
    el: { open: "Ερωτήσεις; Ρωτήστε μας", title: "Βοηθός Hotel Corali", intro: "Γεια σας! Ρωτήστε με για τα δωμάτια, τις τιμές, την περιοχή, την άφιξη ή τις πολιτικές μας.", placeholder: "Γράψτε την ερώτησή σας…", send: "Αποστολή", book: "Διαθεσιμότητα & κράτηση", error: "Συγγνώμη, δεν μπορώ να απαντήσω τώρα. Δοκιμάστε ξανά ή στείλτε μας email.", note: "Αυτόματος βοηθός – οι απαντήσεις μπορεί να έχουν λάθη.", close: "Κλείσιμο" },
    fr: { open: "Des questions ?", title: "Assistant Hotel Corali", intro: "Bonjour ! Posez-moi vos questions sur les chambres, les prix, la région, l’arrivée ou nos conditions.", placeholder: "Votre question…", send: "Envoyer", book: "Disponibilités & réservation", error: "Désolé, je ne peux pas répondre pour le moment. Réessayez ou écrivez-nous.", note: "Assistant automatique – les réponses peuvent contenir des erreurs.", close: "Fermer" },
    de: { open: "Fragen? Fragen Sie uns", title: "Hotel Corali Assistent", intro: "Hallo! Fragen Sie mich zu Zimmern, Preisen, der Umgebung, der Anreise oder unseren Bedingungen.", placeholder: "Ihre Frage…", send: "Senden", book: "Verfügbarkeit & Buchung", error: "Leider kann ich gerade nicht antworten. Bitte versuchen Sie es erneut oder schreiben Sie uns.", note: "Automatischer Assistent – Antworten können Fehler enthalten.", close: "Schließen" },
    it: { open: "Domande? Chiedici", title: "Assistente Hotel Corali", intro: "Ciao! Chiedimi delle camere, dei prezzi, della zona, dell’arrivo o delle nostre condizioni.", placeholder: "Scrivi la tua domanda…", send: "Invia", book: "Disponibilità e prenotazione", error: "Spiacenti, non posso rispondere ora. Riprova o scrivici.", note: "Assistente automatico – le risposte possono contenere errori.", close: "Chiudi" },
    es: { open: "¿Preguntas? Escríbenos", title: "Asistente Hotel Corali", intro: "¡Hola! Pregúntame por las habitaciones, los precios, la zona, la llegada o nuestras condiciones.", placeholder: "Escribe tu pregunta…", send: "Enviar", book: "Disponibilidad y reserva", error: "Lo siento, ahora no puedo responder. Inténtalo de nuevo o escríbenos.", note: "Asistente automático – las respuestas pueden contener errores.", close: "Cerrar" }
  }[lang];

  var host = document.createElement("div");
  host.setAttribute("data-corali-assistant", "");
  document.body.appendChild(host);
  var shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  var css = ":host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".btn{position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;border:0;border-radius:999px;padding:13px 18px;background:" + color + ";color:#fff;font-size:15px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer}" +
    ".btn:hover{filter:brightness(1.08)}" +
    ".panel{position:fixed;bottom:84px;" + side + ":20px;z-index:2147483000;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));display:none;flex-direction:column;background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden;color:#173e47}" +
    ".panel.open{display:flex}.head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:#173e47;color:#fff}.head b{font-size:15px}.x{border:0;background:transparent;color:#fff;font-size:22px;cursor:pointer;line-height:1}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f8f9}.m{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
    ".a{align-self:flex-start;background:#fff;border:1px solid #e1e8ea}.u{align-self:flex-end;background:" + color + ";color:#fff}.typing{opacity:.6}" +
    ".book{display:block;margin:0 14px 8px;padding:10px;border-radius:10px;background:#eef6f8;color:#173e47;text-align:center;font-weight:700;font-size:14px;text-decoration:none}.book:hover{background:#e0eef2}" +
    "form{display:flex;gap:8px;padding:10px 14px 6px;border-top:1px solid #e1e8ea}input{flex:1;padding:10px 12px;border:1px solid #cbd6da;border-radius:10px;font-size:14px}" +
    "form button{border:0;border-radius:10px;padding:0 14px;background:" + color + ";color:#fff;font-weight:700;cursor:pointer}form button:disabled{opacity:.5}.note{padding:0 14px 10px;font-size:11px;color:#6b7b80}";
  shadow.innerHTML = "<style>" + css + "</style>" +
    "<button class='btn' type='button'></button>" +
    "<div class='panel' role='dialog'><div class='head'><b></b><button class='x' type='button'>×</button></div><div class='log' aria-live='polite'></div>" +
    "<a class='book' target='_blank' rel='noopener'></a><form><input maxlength='1500' autocomplete='off'><button type='submit'></button></form><div class='note'></div></div>";
  var $ = function (s) { return shadow.querySelector(s); };
  var btn = $(".btn"), panel = $(".panel"), log = $(".log"), form = $("form"), input = $("input"), send = $("form button");
  btn.textContent = "💬 " + T.open;
  $(".head b").textContent = T.title;
  $(".x").setAttribute("aria-label", T.close);
  $(".book").textContent = T.book;
  $(".book").href = origin + "/book?lang=" + lang;
  input.placeholder = T.placeholder;
  send.textContent = T.send;
  $(".note").textContent = T.note;

  var KEY = "coraliAssistantChat";
  var turns = [];
  try { turns = JSON.parse(sessionStorage.getItem(KEY) || "[]").slice(-20); } catch { turns = []; }
  function bubble(role, text, extra) { var d = document.createElement("div"); d.className = "m " + (role === "user" ? "u" : "a") + (extra ? " " + extra : ""); d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-20))); } catch { /* storage blocked */ } }
  bubble("assistant", T.intro);
  turns.forEach(function (t) { bubble(t.role, t.content); });

  btn.addEventListener("click", function () { panel.classList.toggle("open"); if (panel.classList.contains("open")) input.focus(); });
  $(".x").addEventListener("click", function () { panel.classList.remove("open"); });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q || send.disabled) return;
    input.value = "";
    turns.push({ role: "user", content: q });
    bubble("user", q);
    var wait = bubble("assistant", "…", "typing");
    send.disabled = true;
    fetch(origin + "/api/public/assistant", {
      method: "POST",
      // text/plain keeps this a "simple" cross-site request (no CORS preflight); the server reads it as JSON.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ lang: lang, messages: turns.slice(-12), context: "The visitor is on the hotel website (not the booking form), page: " + (document.title || "").slice(0, 150) + " " + location.href.slice(0, 200) + ". To see prices for their dates they should press \"" + T.book + "\"." })
    }).then(function (r) { return r.json(); }).then(function (d) {
      var text = d && d.ok && d.reply ? d.reply : T.error;
      wait.remove();
      if (d && d.ok) { turns.push({ role: "assistant", content: text }); save(); }
      bubble("assistant", text);
    }).catch(function () { wait.remove(); bubble("assistant", T.error); }).then(function () { send.disabled = false; input.focus(); });
  });
})();
