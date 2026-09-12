# Loop-Protokoll: AMD-Port des Upscaler-Swappers

Dieses Dokument ist die Arbeitsanweisung für **eine** Loop-Iteration. Jede Iteration bearbeitet genau **eine** Aufgabe aus `loop/TASKS.md`. Der Richter ist `node scripts/loop-guard.js`, nicht das eigene Urteil.

Repo: `C:\Users\henri\Documents\Brain\FG-Wpc\upscaler-swapper` · Branch: `amd-port` · Push-Ziel: Remote `fork` (`HenrikBrehm/DLSS5-Swapper-AMD`) · `origin` ist gesperrt.

Ziel des Gesamtlaufs: alle Aufgaben bis einschließlich 5.7 auf `[v]`. Das Werkzeug ist ein Weichensteller über drei Stufen; die Architektur steht oben in `loop/TASKS.md` und wird nicht neu erfunden.

## Rollen

- **Plan** = `loop/TASKS.md`, vom Menschen geschrieben. Akzeptanzkriterien sind fix.
- **Build** = diese Iteration.
- **Judge** = `scripts/loop-guard.js` plus `npm test`, deterministisch und unabhängig.
- **Abnahme** = der Mensch. Der Loop setzt höchstens `[v]`, niemals `[x]`.

## Ablauf einer Iteration

1. **Zustand prüfen.** `git status --porcelain` muss leer sein. Ist er es nicht, also eine abgebrochene Iteration: `git stash push -u -m "loop-abort"`, Zeile in `loop/STATE.md`, weiter.
2. **Aufgabe wählen.** `loop/TASKS.md` lesen. Reihenfolge: erst eine Aufgabe mit `[~]` fortsetzen, sonst die erste `[ ]`, deren `depends` alle `[v]` oder `[x]` sind. `[h]` und `[!]` werden übersprungen.
   - Keine wählbare Aufgabe, aber offene `[h]`/`[!]`: Zeile in STATE.md, `ScheduleWakeup(delaySeconds: 1800, noop: true)`.
   - Alle Aufgaben bis 5.7 sind `[v]` oder `[x]`: Abschlussbericht schreiben, pushen, `ScheduleWakeup(stop: true)`.
3. **Markieren.** Heading der Aufgabe auf `[~]` setzen.
4. **Bauen nach TDD.** Erst Tests schreiben, laufen lassen und scheitern sehen, dann implementieren, dann `npm test`. Nur die in der Aufgabe genannten Dateien plus neue Test- und Fixture-Dateien anfassen. Das Verhalten der NVIDIA-Routen bleibt unverändert.
5. **Richten.** `node scripts/loop-guard.js`. Bei Exit 1 bis zu **zwei** Reparaturversuche innerhalb der Iteration. Danach immer noch rot: `git checkout -- . && git clean -fd`, `retries` der Aufgabe um 1 erhöhen, Heading zurück auf `[ ]`. Bei `retries >= 3` auf `[!]` mit einzeiliger Begründung.
6. **Committen**, nur bei grünem Guard, in zwei Schritten:
   - Code-Commit:
     ```
     feat(amd): <ID> <Titel>

     <2–5 Zeilen: was, warum, was verifiziert wurde>

     Claude-Session: https://claude.ai/code/session_01CMhhPHn6LQ7wo82zvUpoxv
     ```
     Typen: `feat`, `fix`, `test`, `docs`, `chore`.
   - Status-Commit `chore(loop): <ID> verifiziert (<kurz-hash>)`: Heading auf `[v]` plus `commit: <kurz-hash>`, Zeile in `loop/STATE.md`.
7. **Hochladen.** `git push fork amd-port`. Schlägt der Push fehl, etwa weil das Netz weg ist: Zeile in STATE.md, Iteration gilt trotzdem als erfolgreich, der nächste Push holt es nach. Niemals `origin` als Ziel, niemals `--force`.
8. **Berichten.** Kurz auf Deutsch: Aufgabe, Ergebnis, Commit, Push-Status, nächste Aufgabe, offene Mensch-Aufgaben.
9. **Nächste Iteration planen.** `ScheduleWakeup` mit demselben Prompt:
   - nach `[v]`: `delaySeconds: 60`, `noop: false`
   - nach einem Retry: `delaySeconds: 120`, `noop: false`
   - Warten auf den Menschen: `delaySeconds: 1800`, `noop: true`

## Harte Stopps

Der Loop beendet sich selbst mit `ScheduleWakeup(stop: true)` und nennt den Grund:

- Der Guard ist zu Beginn einer Iteration bei sauberem Arbeitsbaum rot. Dann ist die Grundlage kaputt.
- Vier Iterationen in Folge ohne ein neues `[v]`.
- `scripts/loop-guard.js` oder `loop/baseline-tests.json` wurden verändert.
- Alle Aufgaben bis 5.7 sind erledigt.

## Verbote

- Nie zu `origin` pushen, nie `--force`, nie `--amend`, nie `git reset --hard` auf bereits committete Stände, nie einen Pull Request öffnen.
- Nie `scripts/loop-guard.js`, `scripts/loop-baseline.js` oder `loop/baseline-tests.json` ändern, nie `loop-baseline.js` ausführen.
- Nie Tests löschen, abschwächen, überspringen oder Akzeptanzkriterien in TASKS.md ändern.
- Nie Binärdateien committen. Nie `nvngx_*.dll`, `amdxcffx64.dll` oder `dlssnr_on_amd_setup.exe` herunterladen oder kopieren; die Dateinamen dürfen nur in der Erkennungslogik vorkommen.
- Nie Spiele, Installer, Treiberwerkzeuge oder Magpie starten. Registry und Systemeinstellungen nur lesen.
- Nie Aufgaben mit `[h]` bearbeiten. Nie neue npm-Abhängigkeiten außer den in einer Aufgabe ausdrücklich genannten.
- Nie C++ bauen; auf diesem Rechner ist kein Compiler installiert.

## Kontext-Hygiene

- Nicht den ganzen Plan neu lesen, nur die Aufgabe und die dort genannten Dateien.
- Eine Aufgabe pro Iteration. Nicht „schnell noch" die nächste anfangen.
- Bei Unklarheit die konservativste Auslegung wählen, sie in STATE.md notieren, nicht raten und nicht nachfragen, denn nachts antwortet niemand.
