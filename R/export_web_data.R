# =============================================================================
# Export der Reden-Daten für die Webseite  ->  data/speeches.json
# -----------------------------------------------------------------------------
# Eingabe : R/data/speeches_clean.csv   (Ergebnis von engineering.R)
# Ausgabe : data/speeches.json          (wird von der Webseite geladen)
#
# Arbeitsverzeichnis ist der Ordner R/ – beide Pfade unten sind relativ dazu.
#
# Der Export wendet exakt denselben Präsidiums-Filter an wie analysis_final.R,
# damit die Webseite dieselben Reden zeigt wie der Blogbeitrag (47.144 Reden).
# Es werden KEINE Redetexte exportiert, nur Metadaten + Surprisal.
# =============================================================================

library(tidyverse)
library(jsonlite)

# setwd("C:/Users/noah_/Blogbeitrag_Sprache_AfD")   # <- bei Bedarf anpassen

IN_FILE  <- "data/speeches_clean.csv"
OUT_FILE <- "../data/speeches.json"   # data/ im Hauptordner der Webseite
TXT_DIR  <- "../data/texts"           # Redetexte, eine Datei je Person

raw <- read_csv(IN_FILE, show_col_types = FALSE)

# ---- 1. Präsidiumsmitglieder in ihrer Amtszeit entfernen (wie analysis_final.R) ----
PRESIDIUM_TERMS <- tribble(
  ~name, ~office, ~term_start, ~term_end,
  "Wolfgang Schäuble", "Präsident", "2017-10-24", "2021-10-26",
  "Hans-Peter Friedrich", "Vizepräsident", "2017-10-24", "2021-10-26",
  "Thomas Oppermann", "Vizepräsident", "2017-10-24", "2020-10-25",
  "Dagmar Ziegler", "Vizepräsidentin", "2020-11-26", "2021-10-26",
  "Wolfgang Kubicki", "Vizepräsident", "2017-10-24", "2025-03-25",
  "Petra Pau", "Vizepräsidentin", "2017-10-24", "2025-03-25",
  "Claudia Roth", "Vizepräsidentin", "2017-10-24", "2021-12-08",
  "Bärbel Bas", "Präsidentin", "2021-10-26", "2025-03-25",
  "Aydan Özoğuz", "Vizepräsidentin", "2021-10-26", "2025-03-25",
  "Yvonne Magwas", "Vizepräsidentin", "2021-10-26", "2025-03-25",
  "Katrin Göring-Eckardt", "Vizepräsidentin", "2021-12-09", "2025-03-25"
) |>
  mutate(term_start = as.Date(term_start), term_end = as.Date(term_end))

exclude_rows <- raw |>
  inner_join(PRESIDIUM_TERMS, by = "name", relationship = "many-to-many") |>
  filter(date >= term_start, date <= term_end) |>
  distinct(name, date)

d <- raw |>
  anti_join(exclude_rows, by = c("name", "date")) |>
  filter(!is.na(surprisal)) |>
  mutate(date = as.Date(date)) |>
  arrange(date, name)

message("Reden im Export: ", nrow(d), " | Redner:innen: ", n_distinct(d$name))

# ---- 2. Kodierung für kompaktes JSON ------------------------------------------
PARTIES <- c("AFD", "CDU/CSU", "SPD", "GRUENE", "FDP", "DIELINKE")
d <- d |> filter(as.character(party) %in% PARTIES)

# Personentabelle (zeitkonstante Merkmale). Codes: -1 / 0 = unbekannt
speakers <- d |>
  group_by(name) |>
  summarise(
    sex = first(sex_cat),
    edu = first(na.omit(education_level_bt)),
    mig = first(na.omit(mig)),
    .groups = "drop"
  ) |>
  mutate(
    sex = case_when(sex == "männlich" ~ 0L, sex == "weiblich" ~ 1L, TRUE ~ -1L),
    edu = coalesce(as.integer(edu), 0L),
    mig = coalesce(as.integer(mig), -1L)
  ) |>
  arrange(name)

spk_idx <- setNames(seq_len(nrow(speakers)) - 1L, speakers$name)

rows <- d |>
  transmute(
    date  = format(date, "%Y-%m-%d"),
    spk   = unname(spk_idx[name]),
    party = match(as.character(party), PARTIES) - 1L,
    s     = round(surprisal, 4),
    age   = coalesce(as.integer(round(age_at_speech)), -1L),
    gov   = as.integer(gov_status_sens == "Regierung"),
    tok   = as.integer(n_tokens)
  )

out <- list(
  meta = list(
    generated = format(Sys.Date()),
    n_speeches = nrow(rows),
    n_speakers = nrow(speakers),
    model = "Llama-3.2-3B",
    demo = FALSE
  ),
  parties  = PARTIES,
  speakers = unname(pmap(speakers, function(name, sex, edu, mig) list(name, sex, edu, mig))),
  rows     = unname(pmap(rows, function(date, spk, party, s, age, gov, tok)
                          list(date, spk, party, s, age, gov, tok)))
)

dir.create(dirname(OUT_FILE), showWarnings = FALSE, recursive = TRUE)
write_json(out, OUT_FILE, auto_unbox = TRUE, digits = 4, na = "null")
message("Geschrieben: ", OUT_FILE, " (", round(file.size(OUT_FILE) / 1e6, 2), " MB)")

# ---- 3. Redetexte: eine Datei je Person ----------------------------------------
# data/texts/<spk>.json = Texte der Person in derselben Reihenfolge wie ihre Zeilen
# in speeches.json. Die Webseite lädt eine Datei erst, wenn man eine Rede anklickt.
unlink(TXT_DIR, recursive = TRUE)
dir.create(TXT_DIR, recursive = TRUE)
texts <- split(d$text, unname(spk_idx[d$name]))
iwalk(texts, function(x, i) {
  write_json(x, file.path(TXT_DIR, paste0(i, ".json")), auto_unbox = FALSE, na = "null")
})
txt_mb <- sum(file.size(list.files(TXT_DIR, full.names = TRUE))) / 1e6
message("Geschrieben: ", length(texts), " Textdateien in ", TXT_DIR, " (", round(txt_mb), " MB)")
