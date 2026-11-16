# Einfache Botschaften, einfache Sprache? – interaktive Webseite

Statische Seite (HTML/CSS/JS, D3 lokal eingebunden, keine externen Server und Schriften -> DSGVO-freundlich). Kein Build-Schritt, läuft direkt auf GitHub Pages.

## Aufbau der Seite
- **Überblick** (Startseite): Kurzzusammenfassung, Link zum Blogbeitrag, Erklärung „Was ist Surprisal?“, vier Ergebnis-Boxen, Autoren-Box.
- **Analysen** als Tabs in der oberen Leiste: Fraktion, Geschlecht, Bildung, Alter, Regierung & Opposition. Jede zeigt immer alle Reden (bzw. Personen) im Filter – keine Stichproben. Im Plot lässt sich nach Namen suchen.
- **Top 5**: die Personen (Durchschnitt) oder Reden mit der niedrigsten und höchsten Surprisal im Filter. Ein Klick klappt den Redetext auf.
- **Redetexte**: Klick auf einen Punkt zeigt die Rede im Detail-Panel; bei Personen alle ihre Reden zum Aufklappen.
- Sprache umschaltbar (DE / EN, oben rechts). Direkter Link auf eine Sprache: `?lang=en`.

## Struktur
```
index.html          Seitengerüst (Startseite, Top 5)
css/style.css       Design (responsive)
js/config.js        Blog-URL, Team, Befund-Zeile an/aus  <- hier anpassen
js/i18n.js          alle Texte in Deutsch und Englisch   <- hier Texte ändern
js/charts.js        Chart-Engine (Canvas: Dot-Histogramme, Streudiagramm)
js/app.js           Daten laden, Tabs, Filter, Suche, Detail-Panel, Top 5
js/vendor/d3.min.js D3 v7
assets/logo.svg     Logo und Favicon
assets/team/        Fotos der Autoren
data/speeches.json       echte Daten (Export aus R): Metadaten + Surprisal
data/texts/<nr>.json     Redetexte, eine Datei je Person (ca. 190 MB, wird erst bei Klick geladen)
data/speeches.demo.json  SYNTHETISCH (Fallback, mit gelbem Hinweis-Banner)
R/export_web_data.R      Export: R/data/speeches_clean.csv -> data/speeches.json + data/texts/
tools/make_demo_data.py  erzeugt die synthetischen Demo-Daten
```

## Einrichten
1. **Blog-Link:** In `js/config.js` bei `blogUrl` die echte URL eintragen (je Sprache). Solange dort `"#"` steht, sind die Blog-Links Platzhalter ohne Ziel.
2. **Echte Daten:** `R/export_web_data.R` mit Arbeitsverzeichnis `R/` ausführen -> schreibt `data/speeches.json` und die Redetexte nach `data/texts/` (beides gehört zusammen, immer gemeinsam neu erzeugen). Fehlt die Datei, zeigt die Seite Demo-Daten mit Banner.
3. **Ergebnis-Boxen:** Die Kennzahlen der Startseite (`RESULTS` in `js/app.js`) und die Befund-Zeilen unter den Grafiken (`sec.*.finding` in `js/i18n.js`) stammen aus dem Blogbeitrag und werden nicht aus den Daten berechnet – bei neuen Modellergebnissen dort anpassen.
4. **Autorenfotos:** unter `assets/team/` ablegen, Dateinamen in `js/config.js` eintragen (ohne Datei erscheinen Initialen).
5. **Lokal testen:** `python3 -m http.server` im Ordner, dann http://localhost:8000
6. **GitHub Pages:** Repo pushen -> Settings -> Pages -> Branch `main`, Ordner `/ (root)`.

## Nicht ins Repo
`R/data/` enthält die Rohdaten mit vollständigen Redetexten (über 200 MB, über dem Dateilimit von GitHub) und ist per `.gitignore` ausgeschlossen.
