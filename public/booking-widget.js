(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var targetId = script.dataset.target || "corali-booking-widget";
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(targetId)) targetId = "corali-booking-widget";
  var root = document.getElementById(targetId);
  if (!root || root.dataset.coraliWidgetReady === "true") return;
  root.dataset.coraliWidgetReady = "true";

  function safeHttpUrl(value, fallback) {
    try { var parsed = new URL(value, window.location.href); return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : fallback; }
    catch { return fallback; }
  }
  var bookingUrl = safeHttpUrl(script.dataset.bookingUrl || "https://booking.hotelcorali.gr/book", "https://booking.hotelcorali.gr/book");
  var configuredLanguage = (script.dataset.language || "auto").toLowerCase();
  var pageLanguage = (document.documentElement.lang || "en").toLowerCase();
  var language = configuredLanguage === "auto" ? pageLanguage.slice(0, 2) : configuredLanguage;
  if (!["en", "el", "fr", "de", "it", "es"].includes(language)) language = "en";
  var openTarget = ["_self", "_blank"].includes(script.dataset.openTarget) ? script.dataset.openTarget : "_self";
  var maxWidth = String(Math.min(1600, Math.max(480, Number(script.dataset.maxWidth) || 1000)));
  var buttonColor = /^#[0-9a-f]{6}$/i.test(script.dataset.buttonColor || "") ? script.dataset.buttonColor : "#66a728";
  var localeCodes = { en: "en-GB", el: "el-GR", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" };
  var labels = {
    en: { checkin: "Check-in", checkout: "Check-out", adults: "Adults", children: "Children", rooms: "Rooms", button: "BOOK NOW", selectCheckin: "Select check-in date", selectCheckout: "Select check-out date", previous: "Previous months", next: "Next months" },
    el: { checkin: "Άφιξη", checkout: "Αναχώρηση", adults: "Ενήλικες", children: "Παιδιά", rooms: "Δωμάτια", button: "ΚΡΑΤΗΣΗ ΤΩΡΑ", selectCheckin: "Επιλέξτε ημερομηνία άφιξης", selectCheckout: "Επιλέξτε ημερομηνία αναχώρησης", previous: "Προηγούμενοι μήνες", next: "Επόμενοι μήνες" },
    fr: { checkin: "Arrivée", checkout: "Départ", adults: "Adultes", children: "Enfants", rooms: "Chambres", button: "RÉSERVER", selectCheckin: "Sélectionnez la date d’arrivée", selectCheckout: "Sélectionnez la date de départ", previous: "Mois précédents", next: "Mois suivants" },
    de: { checkin: "Anreise", checkout: "Abreise", adults: "Erwachsene", children: "Kinder", rooms: "Zimmer", button: "JETZT BUCHEN", selectCheckin: "Anreisedatum auswählen", selectCheckout: "Abreisedatum auswählen", previous: "Vorherige Monate", next: "Nächste Monate" },
    it: { checkin: "Arrivo", checkout: "Partenza", adults: "Adulti", children: "Bambini", rooms: "Camere", button: "PRENOTA ORA", selectCheckin: "Seleziona la data di arrivo", selectCheckout: "Seleziona la data di partenza", previous: "Mesi precedenti", next: "Mesi successivi" },
    es: { checkin: "Llegada", checkout: "Salida", adults: "Adultos", children: "Niños", rooms: "Habitaciones", button: "RESERVAR", selectCheckin: "Seleccione la fecha de llegada", selectCheckout: "Seleccione la fecha de salida", previous: "Meses anteriores", next: "Meses siguientes" },
  }[language];

  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
  function addDays(date, days) { var result = new Date(date); result.setDate(result.getDate() + days); return result; }
  function isoDate(date) { return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0"); }
  function sameDay(a, b) { return a && b && isoDate(a) === isoDate(b); }
  function displayDate(date) { return new Intl.DateTimeFormat(localeCodes[language], { day: "2-digit", month: "2-digit", year: "numeric" }).format(date); }

  var today = startOfDay(new Date());
  var arrival = today;
  var departure = addDays(arrival, 1);
  var visibleMonth = new Date(arrival.getFullYear(), arrival.getMonth(), 1);
  var selectingCheckout = false;
  var calendarOpen = false;

  var style = document.createElement("style");
  style.textContent =
    "#" + targetId + "{position:relative;width:100%;font-family:Arial,sans-serif}" +
    "#" + targetId + " *{box-sizing:border-box}" +
    "#" + targetId + " .corali-booking-bar{display:grid;grid-template-columns:1.15fr 1.15fr .7fr .7fr .7fr auto;width:min(" + maxWidth + "px,calc(100% - 32px));margin:0 auto;background:#fff;border:1px solid rgba(0,0,0,.12);box-shadow:0 10px 35px rgba(0,0,0,.18)}" +
    "#" + targetId + " label{display:flex;min-width:0;flex-direction:column;gap:4px;padding:8px 14px;border-right:1px solid #ddd;color:#6b7280;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}" +
    "#" + targetId + " select{width:100%;min-width:0;border:0;outline:0;background:#fff;color:#374151;font:14px Arial,sans-serif;height:25px;padding:0}" +
    "#" + targetId + " .corali-date-button{width:100%;height:25px;padding:0;border:0;background:#fff;color:#374151;font:14px Arial,sans-serif;text-align:left;cursor:pointer}" +
    "#" + targetId + " .corali-date-button:focus-visible{outline:2px solid " + buttonColor + ";outline-offset:2px}" +
    "#" + targetId + " .corali-submit{margin:3px;min-width:180px;border:0;background:" + buttonColor + ";color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:filter .2s,transform .2s}" +
    "#" + targetId + " .corali-submit:hover{filter:brightness(.92);transform:translateY(-1px)}" +
    "#" + targetId + " .corali-submit:focus-visible{outline:3px solid rgba(255,255,255,.8);outline-offset:-5px}" +
    "#" + targetId + " .corali-calendar{position:absolute;z-index:99999;left:50%;top:calc(100% + 8px);transform:translateX(-50%);width:min(720px,calc(100vw - 32px));overflow-x:auto;border:1px solid #e3ddd3;border-radius:18px;background:#fff;padding:16px;box-shadow:0 24px 70px rgba(24,60,68,.2)}" +
    "#" + targetId + " .corali-calendar[hidden]{display:none}" +
    "#" + targetId + " .corali-calendar-title{margin:0 0 12px;color:#183c44;font-size:14px;font-weight:700}" +
    "#" + targetId + " .corali-months{display:grid;grid-template-columns:repeat(2,300px);gap:32px;width:max-content}" +
    "#" + targetId + " .corali-month{min-width:300px}" +
    "#" + targetId + " .corali-month-head{display:grid;grid-template-columns:36px 1fr 36px;align-items:center;margin-bottom:10px}" +
    "#" + targetId + " .corali-month-name{text-align:center;color:#111827;font-size:16px;font-weight:700;text-transform:none}" +
    "#" + targetId + " .corali-nav{display:grid;width:34px;height:34px;place-items:center;border:0;border-radius:50%;background:transparent;color:#a94b33;font-size:25px;line-height:1;cursor:pointer}" +
    "#" + targetId + " .corali-nav:hover{background:#f7eee8}" +
    "#" + targetId + " .corali-nav:disabled{cursor:not-allowed;color:#cbd5e1}" +
    "#" + targetId + " .corali-weekdays,#" + targetId + " .corali-days{display:grid;grid-template-columns:repeat(7,40px);justify-content:center}" +
    "#" + targetId + " .corali-weekday{padding:6px 0;text-align:center;color:#6b7280;font-size:11px;font-weight:700;text-transform:none}" +
    "#" + targetId + " .corali-day{display:grid;width:40px;height:40px;place-items:center;border:0;border-radius:50%;background:transparent;color:#111827;font-size:14px;cursor:pointer;position:relative;z-index:1}" +
    "#" + targetId + " .corali-day:hover:not(:disabled){background:#f7eee8}" +
    "#" + targetId + " .corali-day:disabled{color:#cbd5e1;cursor:not-allowed}" +
    "#" + targetId + " .corali-day.outside{color:#9ca3af}" +
    "#" + targetId + " .corali-day.in-range{border-radius:0;background:#f7eee8;color:#183c44}" +
    "#" + targetId + " .corali-day.range-start,#" + targetId + " .corali-day.range-end{border-radius:50%;background:" + buttonColor + ";color:#fff;font-weight:700}" +
    "#" + targetId + " .corali-day.today:not(.range-start):not(.range-end){color:#a94b33;font-weight:700}" +
    "@media(max-width:850px){#" + targetId + " .corali-booking-bar{grid-template-columns:1fr 1fr}#" + targetId + " label{border-bottom:1px solid #ddd}#" + targetId + " .corali-submit{grid-column:1/-1;min-height:48px}}" +
    "@media(max-width:520px){#" + targetId + " .corali-booking-bar{grid-template-columns:1fr;width:calc(100% - 24px)}#" + targetId + " .corali-submit{grid-column:auto}#" + targetId + " .corali-calendar{left:12px;right:12px;transform:none;width:auto}#" + targetId + " .corali-months{grid-template-columns:repeat(2,280px);gap:24px}#" + targetId + " .corali-month{min-width:280px}#" + targetId + " .corali-weekdays,#" + targetId + " .corali-days{grid-template-columns:repeat(7,38px)}#" + targetId + " .corali-day{width:38px;height:38px}}";
  document.head.appendChild(style);

  function options(from, to, selected) {
    var html = "";
    for (var value = from; value <= to; value += 1) html += '<option value="' + value + '"' + (value === selected ? " selected" : "") + ">" + value + "</option>";
    return html;
  }

  root.innerHTML =
    '<form class="corali-booking-bar" novalidate>' +
    '<label>' + labels.checkin + '<button class="corali-date-button" name="checkinButton" type="button"></button><input name="checkin" type="hidden"></label>' +
    '<label>' + labels.checkout + '<button class="corali-date-button" name="checkoutButton" type="button"></button><input name="checkout" type="hidden"></label>' +
    '<label>' + labels.adults + '<select name="adults">' + options(1, 15, 2) + '</select></label>' +
    '<label>' + labels.children + '<select name="children">' + options(0, 10, 0) + '</select></label>' +
    '<label>' + labels.rooms + '<select name="rooms">' + options(1, 6, 1) + '</select></label>' +
    '<button class="corali-submit" type="submit">' + labels.button + '</button></form>' +
    '<div class="corali-calendar" role="dialog" aria-modal="false" hidden><p class="corali-calendar-title"></p><div class="corali-months"></div></div>';

  var form = root.querySelector("form");
  var checkin = form.elements.checkin;
  var checkout = form.elements.checkout;
  var checkinButton = form.elements.checkinButton;
  var checkoutButton = form.elements.checkoutButton;
  var calendar = root.querySelector(".corali-calendar");
  var calendarTitle = root.querySelector(".corali-calendar-title");
  var monthsRoot = root.querySelector(".corali-months");

  function updateFields() {
    checkin.value = isoDate(arrival);
    checkout.value = isoDate(departure);
    checkinButton.textContent = displayDate(arrival);
    checkoutButton.textContent = displayDate(departure);
  }

  function weekdayNames() {
    var monday = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, function (_, index) {
      return new Intl.DateTimeFormat(localeCodes[language], { weekday: "short" }).format(addDays(monday, index)).replace(".", "");
    });
  }

  function monthMarkup(monthDate, monthIndex) {
    var year = monthDate.getFullYear();
    var month = monthDate.getMonth();
    var first = new Date(year, month, 1);
    var offset = (first.getDay() + 6) % 7;
    var gridStart = addDays(first, -offset);
    var weekdays = weekdayNames().map(function (day) { return '<span class="corali-weekday">' + day + "</span>"; }).join("");
    var days = "";
    for (var cell = 0; cell < 42; cell += 1) {
      var date = addDays(gridStart, cell);
      var beforeToday = date < today;
      var outside = date.getMonth() !== month;
      var rangeStart = sameDay(date, arrival);
      var rangeEnd = sameDay(date, departure);
      var inRange = date > arrival && date < departure;
      var classes = ["corali-day"];
      if (outside) classes.push("outside");
      if (sameDay(date, today)) classes.push("today");
      if (inRange) classes.push("in-range");
      if (rangeStart) classes.push("range-start");
      if (rangeEnd) classes.push("range-end");
      days += '<button type="button" class="' + classes.join(" ") + '" data-date="' + isoDate(date) + '"' + (beforeToday ? " disabled" : "") + ' aria-label="' + displayDate(date) + '">' + date.getDate() + "</button>";
    }
    var previous = monthIndex === 0 ? '<button type="button" class="corali-nav corali-prev" aria-label="' + labels.previous + '"' + (visibleMonth <= new Date(today.getFullYear(), today.getMonth(), 1) ? " disabled" : "") + ">&#8249;</button>" : "<span></span>";
    var next = monthIndex === 1 ? '<button type="button" class="corali-nav corali-next" aria-label="' + labels.next + '">&#8250;</button>' : "<span></span>";
    var name = new Intl.DateTimeFormat(localeCodes[language], { month: "long", year: "numeric" }).format(first);
    return '<section class="corali-month"><div class="corali-month-head">' + previous + '<div class="corali-month-name">' + name + "</div>" + next + '</div><div class="corali-weekdays">' + weekdays + '</div><div class="corali-days">' + days + "</div></section>";
  }

  function renderCalendar() {
    calendarTitle.textContent = selectingCheckout ? labels.selectCheckout : labels.selectCheckin;
    monthsRoot.innerHTML = monthMarkup(visibleMonth, 0) + monthMarkup(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1), 1);
  }

  function openCalendar(forCheckout) {
    selectingCheckout = forCheckout;
    var focusDate = forCheckout ? departure : arrival;
    visibleMonth = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
    calendarOpen = true;
    calendar.hidden = false;
    renderCalendar();
  }

  function closeCalendar() { calendarOpen = false; calendar.hidden = true; }
  checkinButton.addEventListener("click", function () { openCalendar(false); });
  checkoutButton.addEventListener("click", function () { openCalendar(true); });
  monthsRoot.addEventListener("click", function (event) {
    var previous = event.target.closest(".corali-prev");
    var next = event.target.closest(".corali-next");
    if (previous && !previous.disabled) { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1); renderCalendar(); return; }
    if (next) { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1); renderCalendar(); return; }
    var day = event.target.closest(".corali-day");
    if (!day || day.disabled) return;
    var parts = day.dataset.date.split("-").map(Number);
    var selected = new Date(parts[0], parts[1] - 1, parts[2]);
    if (!selectingCheckout || selected <= arrival) {
      arrival = selected;
      departure = addDays(selected, 1);
      selectingCheckout = true;
      updateFields();
      renderCalendar();
      return;
    }
    departure = selected;
    updateFields();
    closeCalendar();
  });

  document.addEventListener("pointerdown", function (event) { if (calendarOpen && !root.contains(event.target)) closeCalendar(); });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeCalendar(); });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var url = new URL(bookingUrl, window.location.href);
    new FormData(form).forEach(function (value, key) { url.searchParams.set(key, String(value)); });
    url.searchParams.set("lang", language);
    url.searchParams.set("source", "hotel-website-widget");
    var opened = window.open(url.toString(), openTarget, openTarget === "_blank" ? "noopener,noreferrer" : undefined);
    if (opened) opened.opener = null;
  });
  updateFields();
})();
