#!/usr/bin/env python3
"""Erzeugt SYNTHETISCHE Demo-Daten (data/speeches.demo.json).

Die Werte sind zufällig erzeugt und haben nichts mit echten Abgeordneten oder
echten Surprisal-Werten zu tun. Sie dienen nur dazu, die Webseite ohne den
echten Datensatz auszuprobieren. Die Webseite blendet bei Demo-Daten einen
deutlichen Hinweis ein.

Aufruf:  python3 tools/make_demo_data.py
"""
import json, random, datetime as dt

random.seed(7)
PARTIES = ["AFD", "CDU/CSU", "SPD", "GRUENE", "FDP", "DIELINKE"]
SHARE = [0.11, 0.30, 0.24, 0.12, 0.12, 0.11]          # Redner-Anteile
FEMALE = [0.12, 0.25, 0.42, 0.58, 0.28, 0.52]
N_SPK, N_ROWS = 260, 7000

speakers, spk_party, spk_age0 = [], [], []
for i in range(N_SPK):
    p = random.choices(range(6), SHARE)[0]
    sex = 1 if random.random() < FEMALE[p] else 0
    edu = random.choices([1, 2, 3], [0.2, 0.55, 0.25] if p != 0 else [0.25, 0.5, 0.25])[0]
    mig = 1 if random.random() < 0.08 else 0
    speakers.append([f"Demo-Person {i+1:03d}", sex, edu, mig])
    spk_party.append(p)
    spk_age0.append(random.randint(30, 72))

start, end = dt.date(2017, 10, 24), dt.date(2025, 3, 20)
span = (end - start).days
rows = []
for _ in range(N_ROWS):
    i = random.randrange(N_SPK)
    p = spk_party[i]
    d = start + dt.timedelta(days=random.randrange(span))
    if d.weekday() > 4:
        d -= dt.timedelta(days=d.weekday() - 4)
    age = spk_age0[i] + (d.year - 2017)
    gov = 1 if ((d < dt.date(2021, 12, 8) and p in (1, 2)) or
                (d >= dt.date(2021, 12, 8) and p in (2, 3, 4) and not (p == 4 and d >= dt.date(2024, 11, 7)))) else 0
    tok = int(random.lognormvariate(6.3, 0.7)) + 50
    s = (2.15 + 0.05 * (p == 0) - 0.04 * gov + 0.0012 * (age - 50)
         + 0.012 * (d.year - 2017) - 0.01 * speakers[i][1] + random.gauss(0, 0.11))
    rows.append([d.isoformat(), i, p, round(s, 4), age, gov, tok])

rows.sort(key=lambda r: r[0])
out = {"meta": {"generated": str(dt.date.today()), "n_speeches": len(rows), "n_speakers": N_SPK,
                "model": "SYNTHETISCH", "demo": True},
       "parties": PARTIES, "speakers": speakers, "rows": rows}
with open("data/speeches.demo.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("OK", len(rows), "Reden")
