# Loop-Protokoll: AMD-Port des Upscaler-Swappers

Dieses Dokument ist die Arbeitsanweisung für **eine** Loop-Iteration. Jede Iteration bearbeitet genau **eine** Aufgabe aus `loop/TASKS.md`. Der Richter ist `node scripts/loop-guard.js`, nicht das eigene Urteil.

Repo: `C:\Users\henri\Documents\Brain\FG-Wpc\upscaler-swapper` · Branch: `amd-port` · Plan: `../AMD-Upscaling-Plan.md`

## Rollen

- **Plan** = `loop/TASKS.md` (vom Menschen geschrieben, Akzeptanzkriterien sind fix).
- **Build** = diese Iteration.
- **Judge** = `scripts/loop-guard.js` + `npm test` (deterministisch, unabhängig).
- **Abnahme** = der Mensch. Der Loop setzt maximal `[v]` (verifiziert), nie `[x]` (akzeptiert).

## Ablauf einer Iteration

1. **Zustand prüfen.** `git status --porcelain` muss leer sein. Ist er es nicht (abgebrochene Iteration): `git stash push -u -m "loop-abort"` und in `loop/STATE.md` notieren, dann weiter.
2. **Aufgabe wählen.** `loop/TASKS.md` lesen. Reihenfolge: erst eine Aufgabe mit `[~]` (wiederaufnehmen), sonst die erste `[ ]`, deren `depends`-Einträge alle `[v]` oder `[x]` sind. Aufgaben mit `[h]` (Mensch) und `[!]` (blockiert) werden übersprungen.
   - Keine wählbare Aufgabe, aber offene `[h]`/`[!]`: Eintrag in STATE.md, `ScheduleWakeup(delaySeconds: 1800, noop: true)`.
   - Alle Aufgaben `[v]`/`[x]`: Abschlussbericht, `ScheduleWakeup(stop: true)`.
3. **Markieren.** Heading der Aufgabe auf `[~]` setzen.
4. **Bauen (TDD).** Erst Tests schreiben (RED), dann implementieren (GREEN), dann `npm test`. Nur die in der Aufgabe genannten Dateien plus neue Test-/Fixture-Dateien anfassen. Bestehendes Verhalten der NVIDIA-Routen nicht ändern.
5. **Richten.** `node scripts/loop-guard.js`. Bei Exit 1: bis zu **zwei** Reparaturversuche innerhalb der Iteration. Danach immer noch rot → `git checkout -- . && git clean -fd` (alles verwerfen), `retries` der Aufgabe in TASKS.md um 1 erhöhen, Heading zurück auf `[ ]`; bei `retries >= 3` → `[!]` mit einzeiliger Begründung.
6. **Committen** (nur bei grünem Guard). `git add -A`, Commit-Message im Format:
   ```
   feat(amd): <ID> <Titel>

   <2–5 Zeilen: was, warum, was verifiziert>

   Claude-Session: https://claude.ai/code/session_01CMhhPHn6LQ7wo82zvUpoxv
   ```
   Typen: `feat`, `fix`, `test`, `docs`, `chore`. Danach in einem **zweiten** Commit `chore(loop): <ID> verifiziert (<kurz-hash>)`: Heading in TASKS.md auf `[v]` + `commit: <kurz-hash>` setzen und STATE.md-Zeile anhängen (der Hash des Code-Commits ist erst danach bekannt).
7. **Berichten.** Eine kurze Nachricht auf Deutsch: Aufgabe, Ergebnis (grün/rot/blockiert), Commit, nächste Aufgabe, offene Mensch-Aufgaben.
8. **Nächste Iteration planen.** `ScheduleWakeup` mit demselben Prompt:
   - nach `[v]`: `delaySeconds: 60, noop: false`
   - nach Retry: `delaySeconds: 120, noop: false`
   - Warten auf Mensch: `delaySeconds: 1800, noop: true`

## Harte Stopps (Loop beendet sich selbst mit `stop: true` und meldet den Grund)

- Guard ist zu Beginn einer Iteration bei sauberem Arbeitsbaum rot (Baseline kaputt).
- Drei Iterationen in Folge ohne ein neues `[v]`.
- `scripts/loop-guard.js` oder `loop/baseline-tests.json` wurden verändert.

## Verbote (gelten immer)

- Nie `git push`, nie `origin` ändern, nie `--amend`, nie `--force`, nie `git reset --hard` auf committete Stände.
- Nie `scripts/loop-guard.js`, `scripts/loop-baseline.js`, `loop/baseline-tests.json` ändern oder `loop-baseline.js` ausführen.
- Nie Tests löschen, schwächen (`assert` entfernen, `skip`, `todo`) oder Akzeptanzkriterien in TASKS.md ändern.
- Nie Binärdateien committen. Nie `nvngx_*.dll`, `amdxcffx64.dll`, `dlssnr_on_amd_setup.exe` herunterladen, kopieren oder referenzieren außer als Dateiname in Erkennungslogik.
- Nie Spiele, Installer oder Treiber-Tools starten. Nie Systemeinstellungen oder Registry schreiben (lesen ist erlaubt).
- Nie Aufgaben mit `[h]` bearbeiten oder Entscheidungen des Menschen (Abschnitt 8 im Plan) vorwegnehmen.
- Keine neuen npm-Abhängigkeiten außer den in der Aufgabe genannten.

## Kontext-Hygiene

- Nicht den ganzen Plan neu lesen; nur die Aufgabe und die dort genannten Dateien.
- Pro Iteration eine Aufgabe. Nicht „schnell noch" die nächste anfangen.
- Bei Unklarheit in einer Aufgabe: die konservativste Auslegung wählen, die Auslegung in STATE.md notieren, nicht raten und nicht fragen (niemand antwortet).
