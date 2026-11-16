// ---------------------------------------------------------------------------
// Zentrale Einstellungen – hier einfach anpassen, kein weiterer Code nötig.
// Alle Texte (Deutsch / Englisch) stehen in js/i18n.js.
// ---------------------------------------------------------------------------
window.SITE = {
  // Daten: echte Daten (R-Export) und synthetischer Fallback
  dataUrl: "data/speeches.json",
  demoUrl: "data/speeches.demo.json",
  // Redetexte: eine Datei je Person (<Nummer>.json), wird erst bei Klick geladen
  textUrl: "data/texts",

  // Link zum Blogbeitrag je Sprache. "#" ist ein PLATZHALTER – hier die echte URL eintragen.
  blogUrl: { de: "#", en: "#" },

  // Einzeiler „Befund der Studie“ unter jeder Grafik anzeigen (false = ausblenden)
  showFindings: true,

  // Autoren-Box auf der Startseite. Fotos liegen lokal unter assets/team/
  // (ohne Datei erscheinen die Initialen).
  team: [
    {
      name: "Nick Schlitter",
      linkedin: "https://www.linkedin.com/in/nick-schlitter/",
      photo: "assets/team/nick-schlitter.jpeg"
    },
    {
      name: "Noah Schulz",
      linkedin: "https://www.linkedin.com/in/noah-schulz-971031301/",
      photo: "assets/team/noah-schulz.jpeg"
    }
  ]
};
