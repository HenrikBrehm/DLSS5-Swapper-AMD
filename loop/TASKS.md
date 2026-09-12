# Aufgabenliste: AMD-Port (Loop-Queue)

Legende im Heading: `[ ]` offen · `[~]` in Arbeit · `[v]` vom Guard verifiziert, wartet auf Abnahme · `[x]` vom Menschen akzeptiert · `[!]` blockiert (Begründung im Heading) · `[h]` Mensch-Aufgabe, Loop überspringt.

Jede Aufgabe: `depends`, Ziel, Dateien, **Akzeptanz** (maschinell prüfbar), Grenzen, `retries`. Akzeptanzkriterien ändert nur der Mensch.

Gesicherte Fakten (nicht neu recherchieren):
- Test-Rechner: RX 7900 XT (RDNA3), Adrenalin 26.8.1, Treiber 32.0.31041.1004. Registry: `HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\00NN` mit Werten `DriverDesc`, `DriverVersion`, `RadeonSoftwareVersion` (z.B. `26.8.1`), `ReleaseVersion`. FSR-4-DLL: `C:\Windows\System32\DriverStore\FileRepository\u*.inf_amd64_*\B*\amdxcffx64.dll` (FileVersion 2.3.0.3193). NVIDIA liefert weiterhin `nvidia-smi.exe --query-gpu=name,driver_version --format=csv,noheader`.
- FSR 4.1 auf RDNA3 offiziell ab Adrenalin 26.6.2 (Desktop-dGPU). RDNA4 immer. RDNA2 noch nicht (2027). Mobile RDNA3/3.5 nicht.
- OptiScaler 0.9.4 (upstream): `https://github.com/optiscaler/OptiScaler/releases/download/v0.9.4/Optiscaler_0.9.4-final.20260718._MM.7z` (55 016 448 Bytes, **7z**, nicht zip). Enthält OptiScaler.dll, OptiScaler.ini, fakenvapi 1.4.1, Nukem dlssg-to-fsr3 0.130, FFX-DLLs, XeSS-DLLs, GPL-3.0. Hook-Namen: `dxgi.dll` (DX11/12), `winmm.dll` (Vulkan), Alternativen `version.dll`, `dbghelp.dll`.
- Der i18n-Test verlangt jeden neuen `feature-i18n`-Key in **allen 38 Sprachen** mit identischen Platzhaltern.
- Testmuster: `node:test`, temporäre Spielordner via `fs.mkdtempSync`, injizierbare Runner (siehe `test/driver-barrier.test.js`, `test/apply-feeder64.test.js`).

---

## Phase 1 – Vendor-Abstraktion + Route `amd-optiscaler`

### [v] 1.1 GPU-Erkennung generisch (`src/core/gpu-detect.js`) — commit: 9e79cf5
- depends: –
- Ziel: `detect({ runNvidiaSmi, runPowerShell, readRegistry, globDriverStore })` liefert Zeilen `{ name, vendor: 'nvidia'|'amd'|'intel'|'unknown', driver, adrenalin: '26.8.1'|null, rdnaGen: 1|2|3|4|null, mobile: bool, fsr4Capable: bool, fsr4Dll: {path, version}|null }`. Alle externen Aufrufe injizierbar; reine Parser-Funktionen exportiert (`parseNvidiaSmi`, `parseVideoControllers`, `rdnaGenFromName`, `compareVersions`, `fsr4Capable`). Regel: `fsr4Capable = rdnaGen>=4 || (rdnaGen===3 && !mobile && compareVersions(adrenalin,'26.6.2')>=0)`. Namens-Tabelle: `RX 5xxx`→1, `RX 6xxx`→2, `RX 7xxx`→3, `RX 9xxx`→4, `Radeon 7xxM/8xxM`, `Radeon(TM) Graphics`, `780M/890M` → mobile.
- Dateien: neu `src/core/gpu-detect.js`, neu `test/gpu-detect.test.js`.
- Akzeptanz: ≥ 10 Tests, davon Fixtures für RX 7900 XT/26.8.1 (fsr4Capable true), RX 7900 XT/26.5.1 (false), RX 9070 XT (true), RX 6800 (false), Radeon 890M (false), RTX 4090 via nvidia-smi (vendor nvidia), kein Adapter (leere Liste, kein Throw), fehlerhafter PowerShell-Output (kein Throw). Guard grün.
- Grenzen: `install-guards.js` in dieser Aufgabe nicht anfassen. Keine echten Systemaufrufe in Tests.
- retries: 0

### [ ] 1.2 `install-guards.js` an gpu-detect anbinden
- depends: 1.1
- Ziel: `gpuInfo()` nutzt `gpu-detect`, gibt weiterhin `{name, driver}`-Zeilen zurück (Rückwärtskompatibel für `driverNeuralFault`, `driverNames`, `gpuSupported`) plus die neuen Felder. Neue Exporte `vendorOf(rows)` ('amd' wenn eine AMD-Zeile existiert und keine NVIDIA-Zeile, sonst 'nvidia'/'mixed'/'unknown') und `amdFsr4Ready(rows)`. `driverNeuralFault` reagiert nur auf NVIDIA-Zeilen (wie heute).
- Dateien: `src/core/install-guards.js`, `test/driver-barrier.test.js` (nur erweitern), neu `test/install-guards-vendor.test.js`.
- Akzeptanz: alle bestehenden Tests unverändert grün; ≥ 5 neue Tests (amd-only, nvidia-only, mixed, keine GPU, fsr4Ready). Guard grün.
- Grenzen: Rückgabeform für NVIDIA-Zeilen bleibt exakt `{name, driver, ...}`.
- retries: 0

### [ ] 1.3 Scan: Upscaler-Inventar pro Spiel (`target.upscalers`)
- depends: –
- Ziel: `scan.js` ergänzt pro Ziel `upscalers = { dlss, dlssg, fsr2, fsr31, fsr31Signed, xess, streamline }` (Booleans) aus Dateinamen im Exe-Ordner und bis 2 Ebenen darunter: DLSS `nvngx_dlss.dll`; DLSS-FG `nvngx_dlssg.dll`/`sl.dlss_g.dll`; Streamline `sl.interposer.dll`; FSR2 `ffx_fsr2_api_x64.dll`, `ffx_fsr2_api_dx12_x64.dll`, `ffx_fsr2_api_vk_x64.dll`; FSR3.1 `amd_fidelityfx_dx12.dll`, `amd_fidelityfx_vk.dll`, `amd_fidelityfx_upscaler_dx12.dll`, `ffx_fsr3upscaler_x64.dll`, `ffx_backend_dx12_x64.dll`; XeSS `libxess.dll`, `libxess_dx11.dll`. `fsr31Signed` über injizierbaren `isSigned(file)`-Callback (Default: PowerShell `Get-AuthenticodeSignature`, im Scan nur bei vorhandener FSR3.1-DLL aufgerufen; in Tests immer gestubbt).
- Dateien: `src/core/scan.js` (ergänzen, nichts umbauen), neu `test/scan-upscalers.test.js`.
- Akzeptanz: ≥ 6 Tests (nur DLSS, DLSS+FG, FSR3.1 signiert/unsigniert, XeSS, nichts); bestehende Scan-Tests grün; `upscalers` ist immer ein Objekt, auch bei alten Manifesten. Guard grün.
- Grenzen: `primaryDlss`/`hasNativeDlss`-Logik nicht verändern.
- retries: 0

### [ ] 1.4 Routen-Registry + vendor-abhängiges `routesFor`
- depends: 1.2, 1.3
- Ziel: `src/shared/install-routes.js`: `routesFor(target, api, gpu)` – ohne `gpu` exakt heutiges Verhalten. Mit `gpu.vendor==='amd'`: nur `amd-driver` (immer, wenn `api==='dxgi'` und DX12, oder Anti-Cheat) und `amd-optiscaler` (64-Bit, kein Emulator, `api` in `dxgi`/`vulkan`, nicht DX10, und `upscalers.dlss||fsr2||fsr31||xess`), niemals `native`/`feeder`/`renodx`/`optiscaler`. Neuer Export `routeMeta(route)` → `{ vendor, label, needsGpu }`. `backend-manager.js`: Routen-Whitelist in `profileFile()` und `configPaths()` um `amd-optiscaler` (Config `OptiScaler.ini`) und `amd-driver` (keine Dateien) ergänzen. `recommendedRoute` bevorzugt auf AMD `amd-driver` bei `fsr31Signed`, sonst `amd-optiscaler`.
- Dateien: `src/shared/install-routes.js`, `src/core/backend-manager.js`, `test/install-routes.test.js` (erweitern), neu `test/install-routes-amd.test.js`.
- Akzeptanz: bestehende Tests grün; ≥ 8 neue Tests inkl. „ohne gpu unverändert", Anti-Cheat → nur `amd-driver`, Vulkan+DLSS → `amd-optiscaler`, DX11 32-Bit → `[]`. Guard grün.
- Grenzen: `optiReason()` unverändert.
- retries: 0

### [ ] 1.5 OptiScaler-upstream als Komponente (7z, Pinning, Payload-Validierung)
- depends: –
- Ziel: `src/core/optiscaler-upstream.js`: Release-Eintrag `{ version: '0.9.4', url: <s.o.>, sha256, licenseUrl: raw GPL aus optiscaler/OptiScaler master, licenseHash }`. Der Loop lädt das Archiv einmal nach `tools/optiscaler-0.9.4.7z` (gitignored), berechnet SHA-256 und trägt sie ein. 7z-Extraktion über npm-Paket `7zip-bin` (liefert `7za.exe`, LGPL) + `child_process` – kein anderes neues Paket. Nach Extraktion `loop/optiscaler-0.9.4-files.txt` (Dateiliste mit Größen) ins Repo schreiben und `validateUpstreamPayload(root)` daraus ableiten (Pflichtdateien: `OptiScaler.dll`, `OptiScaler.ini`, `fakenvapi.dll`, `fakenvapi.ini`, Nukem-DLL, `amd_fidelityfx_*`, `libxess*`). `ensureOptiScalerUpstream(cacheRoot)` analog zu `ensureOptiScaler`. `THIRD_PARTY_NOTICES.md` um OptiScaler upstream, fakenvapi, Nukem, 7zip-bin ergänzen.
- Dateien: neu `src/core/optiscaler-upstream.js`, `package.json` (nur `7zip-bin` unter dependencies), `package-lock.json`, `THIRD_PARTY_NOTICES.md`, neu `loop/optiscaler-0.9.4-files.txt`, neu `test/optiscaler-upstream.test.js`, `test/fixtures/optiscaler-0.9.4.ini` (die echte INI aus dem Archiv, unverändert).
- Akzeptanz: ≥ 6 Tests mit Fake-Payload-Ordnern (vollständig, Datei fehlt, 32-Bit-DLL → `errOptiPayload`, Hash-Mismatch → `componentChecksum`); Extraktion in Tests gestubbt; Fixture-INI ≥ 100 Zeilen; Guard grün (kein 7z/dll im Index!).
- Grenzen: `optiscaler.js` (NVIDIA-Fork) nicht verändern.
- retries: 0

### [ ] 1.6 AMD-Konfigurator `configureAmd()`
- depends: 1.5
- Ziel: `configureAmd(iniText, target, gpu, options)` in `optiscaler-upstream.js`. Options: `{ output: 'fsr4'|'fsr31'|'xess', inputs: 'dxgi-spoof'|'fakenvapi'|'none', fg: 'none'|'nukem'|'optifg'|'fsr-fg', antiLag2: bool }`. Setzt nur Keys, die in `test/fixtures/optiscaler-0.9.4.ini` **existieren** (Test erzwingt das: jeder gesetzte `[Sektion] Key` muss in der Fixture vorkommen). Mindestens: Upscaler pro API (`Dx12Upscaler`, `Dx11Upscaler`, `VulkanUpscaler`), FSR4-Upgrade-Schalter, Spoofing-Schalter, FG-Typ, Logging an, ProcessFilter auf Exe-Name. Defaults für RDNA3: output fsr4 (wenn `gpu.fsr4Capable`, sonst fsr31), inputs `dxgi-spoof` bei `upscalers.dlss && !fsr2 && !fsr31 && !xess`, fg `none`.
- Dateien: `src/core/optiscaler-upstream.js`, `test/optiscaler-upstream.test.js` (erweitern).
- Akzeptanz: ≥ 8 Tests (Defaults RDNA3/RDNA4/RDNA2, jede Option, Key-Existenz-Test gegen Fixture, Idempotenz: zweimal anwenden = einmal). Guard grün.
- Grenzen: keine Keys erfinden; wenn ein gewünschter Schalter in der INI nicht existiert → in STATE.md notieren und weglassen.
- retries: 0

### [ ] 1.7 Route `amd-optiscaler` installieren/wiederherstellen
- depends: 1.4, 1.6
- Ziel: `src/core/routes/amd-optiscaler.js` mit `install(config, log)` analog `optiscaler.install`: Manifest `route: 'amd-optiscaler'`, Copy-Plan aus dem Upstream-Layout (`OptiScaler.dll` → Hook-Name je API; `fakenvapi.dll`+`.ini` nur bei `inputs==='fakenvapi'`; Nukem-DLL nur bei `fg==='nukem'`; FFX-/XeSS-Bibliotheken; Lizenzen nach `OptiScaler/licenses/`), `OptiScaler.ini` via `configureAmd`, Konfliktprüfung mit `optiscaler.checkConflicts`. `backend-manager.install()` dispatcht auf die neue Route; `restore` funktioniert unverändert.
- Dateien: neu `src/core/routes/amd-optiscaler.js`, `src/core/backend-manager.js`, neu `test/apply-amd-optiscaler.test.js`.
- Akzeptanz: ≥ 6 Tests: Install DX12/Vulkan (Hook-Name), fakenvapi-Option, Nukem-Option, Konflikt mit fremder `dxgi.dll` → `errOptiConflict`, Restore stellt Ordner byte-identisch wieder her (SHA-256-Vergleich aller Dateien), Reinstall idempotent. Guard grün.
- Grenzen: keine Änderung an `apply.js` außer ggf. Export bestehender Helfer.
- retries: 0

### [ ] 1.8 Verify: OptiScaler-Log auswerten
- depends: 1.7
- Ziel: `src/core/verify.js`: `parseOptiScalerLog(text)` → `{ upscaler: string|null, fsr4: bool, int8: bool, fg: string|null, errors: string[] }`, `verifyInstall(gameDir, exePath)` liest `OptiScaler.log` (Exe-Ordner) und liefert `{ state: 'ok'|'no-log'|'failed', details }`. IPC-Handler `verify-install` in `main.js`; Renderer zeigt Badge (Text via feature-i18n-Keys `verifyOk`, `verifyNoLog`, `verifyFailed` in allen 38 Sprachen).
- Dateien: neu `src/core/verify.js`, `main.js`, `src/renderer/renderer.js`, `src/shared/feature-i18n.js`, neu `test/verify.test.js`, neu `test/fixtures/optiscaler-log-*.txt` (synthetisch, an OptiScaler-Logformat angelehnt; als synthetisch markieren).
- Akzeptanz: ≥ 6 Parser-Tests; i18n-Test grün (alle 38 Sprachen); Guard grün.
- Grenzen: Log-Muster gelten als Hypothese bis der Mensch ein echtes Log liefert (Mensch-Aufgabe H6).
- retries: 0

### [ ] 1.9 UI/i18n für die AMD-Routen
- depends: 1.7
- Ziel: Routenauswahl im Renderer zeigt auf AMD `FSR 4 via OptiScaler` und `AMD-Treiber (geführt)`; OptiScaler-Bestätigungsdialog in `main.js` ist vendor-abhängig (AMD: Adrenalin-Version, FSR-4-Fähigkeit, Hinweis auf Anti-Cheat; keine Blackwell-/616.56-Texte). Neue feature-i18n-Keys in allen 38 Sprachen.
- Dateien: `main.js`, `src/renderer/renderer.js`, `src/renderer/index.html`, `src/shared/feature-i18n.js`, `test/feature-i18n.test.js` (nur erweitern), neu `test/amd-dialog.test.js` (Dialog-Texte über Stubs wie in `driver-barrier.test.js`).
- Akzeptanz: i18n-Test grün; ≥ 4 Tests für Dialog-Inhalte (AMD fsr4Capable / nicht fähig / NVIDIA unverändert). Guard grün.
- Grenzen: NVIDIA-Dialoge byte-identisch lassen.
- retries: 0

### [ ] 1.10 Doku Phase 1
- depends: 1.9
- Ziel: `README-AMD.md` (Deutsch + Englisch, je ≤ 150 Zeilen): Voraussetzungen, Routen, was nicht geht (Anti-Cheat, RDNA2, Vulkan-Treiber-Override), Verify, Restore. `THIRD_PARTY_NOTICES.md` prüfen.
- Dateien: neu `README-AMD.md`, `THIRD_PARTY_NOTICES.md`.
- Akzeptanz: Datei existiert, beide Sprachen, alle Routen-IDs aus `routeMeta` kommen vor (Test `test/readme-amd.test.js`). Guard grün.
- retries: 0

## Phase 2 – Route `amd-driver` (geführt)

### [ ] 2.1 Route `amd-driver`: Eignung + Anleitungsschritte
- depends: 1.4
- Ziel: `src/core/routes/amd-driver.js`: `steps(target, gpu)` → Liste `{ id, i18nKey, applies: bool }` für `fsr4Toggle` (nur `upscalers.fsr31Signed && dx12 && gpu.fsr4Capable`), `afmf` (immer außer DX8/DDraw), `rsr` (immer), `antiLag2` (immer), `optiscalerFallback` (wenn Vulkan mit FSR3.1). `install()` legt **keine** Dateien im Spiel an, schreibt nur ein Manifest mit `route: 'amd-driver'` und `checklist: {}`; `restore` entfernt nur das Manifest. Adrenalin-Start: `RadeonSoftware.exe` unter `%ProgramFiles%\AMD\CNext\CNext\` per `shell.openPath`, wenn vorhanden.
- Dateien: neu `src/core/routes/amd-driver.js`, `src/core/backend-manager.js`, `src/shared/feature-i18n.js` (Keys in 38 Sprachen), neu `test/amd-driver.test.js`.
- Akzeptanz: ≥ 6 Tests (Schritte je Fall, keine Datei im Spielordner nach install, Manifest-Roundtrip, Restore). Guard grün.
- retries: 0

### [ ] 2.2 Checkliste pro Spiel persistieren + UI
- depends: 2.1
- Ziel: Häkchen pro Schritt werden im Library-State (`library.json`) unter dem Spiel gespeichert; IPC `amd-driver-checklist` get/set; Renderer-Ansicht mit Schrittliste und Adrenalin-Button.
- Dateien: `main.js`, `src/library.js`, `src/renderer/renderer.js`, `src/renderer/index.html`, neu `test/amd-driver-checklist.test.js`.
- Akzeptanz: ≥ 4 Tests (set/get, Persistenz über Neuladen, unbekanntes Spiel, ungültige Eingabe wird verworfen). Guard grün.
- retries: 0

### [ ] 2.3 Anti-Cheat auf AMD → ausschließlich `amd-driver`
- depends: 2.1
- Ziel: `routesFor` liefert bei `compatibility.hasAntiCheat` auf AMD nur `amd-driver`; Anti-Cheat-Dialog erscheint dort nicht (keine Injektion).
- Dateien: `src/shared/install-routes.js`, `main.js`, `test/install-routes-amd.test.js` (erweitern).
- Akzeptanz: ≥ 3 Tests. Guard grün.
- retries: 0

## Phase 5 – Frame Generation

### [ ] 5.1 FG-Planer (`src/core/fg-plan.js`)
- depends: 1.3
- Ziel: `planFrameGen({ api, apiLabel, bitness, upscalers, gpu, route })` → `{ fg: 'native'|'nukem'|'optifg'|'fsr-fg'|'afmf'|'none', note }` nach der Tabelle im Plan (Phase 5): FSR3-FG nativ → native; DLSS-FG vorhanden + DX12/VK → nukem; DX12 ohne FG + amd-optiscaler → optifg; DX11/VK/GL/DX9 → afmf; RDNA3 nie `fsr4-fg`.
- Dateien: neu `src/core/fg-plan.js`, neu `test/fg-plan.test.js`.
- Akzeptanz: tabellengetriebener Test mit ≥ 12 Fällen. Guard grün.
- retries: 0

### [ ] 5.2 FG-Auswahl in Route und UI
- depends: 5.1, 1.7
- Ziel: `amd-optiscaler`-Options-Default `fg` kommt aus `planFrameGen`; Renderer bietet Auswahl (none/nukem/optifg/fsr-fg) mit Empfehlung vorbelegt; Keys in 38 Sprachen.
- Dateien: `src/core/routes/amd-optiscaler.js`, `main.js`, `src/renderer/renderer.js`, `src/shared/feature-i18n.js`, `test/apply-amd-optiscaler.test.js` (erweitern).
- Akzeptanz: ≥ 3 neue Tests. Guard grün.
- retries: 0

## Phase 6 – Produktreife (Code-Anteile)

### [ ] 6.1 Community-Report: Vendor-Felder
- depends: 1.2
- Ziel: Report-Payload enthält `vendor`, `route`, `upscalerOutput`, `fgType`, `adrenalinVersion` (null wenn unbekannt); Server-Kompatibilität: unbekannte Felder werden vom Client nicht als Fehler behandelt.
- Dateien: `src/community-client.js`, `main.js`, `test/community-client.test.js` (erweitern).
- Akzeptanz: ≥ 3 neue Tests; bestehende grün. Guard grün.
- retries: 0

### [ ] 6.2 Diagnose-Bundle um AMD-Daten erweitern
- depends: 1.2, 1.8
- Ziel: `diagnostics.js` sammelt Adrenalin-Version, `amdxcffx64.dll`-Pfad+Version, `OptiScaler.log` (gekürzt auf 200 KB) mit ein.
- Dateien: `src/core/diagnostics.js`, `test/diagnostics.test.js` (erweitern).
- Akzeptanz: ≥ 3 neue Tests. Guard grün.
- retries: 0

### [ ] 6.3 Kompatibilitätsliste importieren (Script + Parser)
- depends: –
- Ziel: `scripts/import-compat-amd.js` lädt die OptiScaler-Wiki-Seite „FSR4 Compatibility List" (Markdown via raw GitHub-Wiki-URL) und erzeugt `src/data/compat-amd.json` `{ game, status, notes }[]`; Parser als reine Funktion in `src/core/compat-amd.js`. Netzwerk nur im Script, nie in Tests.
- Dateien: neu `scripts/import-compat-amd.js`, neu `src/core/compat-amd.js`, neu `src/data/compat-amd.json` (erste Fassung, ≤ 2 MB), neu `test/compat-amd.test.js`, neu `test/fixtures/compat-amd-sample.md`.
- Akzeptanz: ≥ 4 Parser-Tests; JSON valide und ≥ 100 Einträge. Guard grün.
- retries: 0

## Phase 3 – FSR-Feeder (nur was ohne MSVC geht)

### [ ] 3.1 Design-Dokument FSR-Feeder (Port-Karte)
- depends: –
- Ziel: DLSS5-Feeder (MIT) flach nach `vendor/dlss5-feeder/` klonen (gitignored) und `fsr-feeder/DESIGN.md` schreiben: für **jede** Quelldatei des Originals eine Zeile `Datei | behalten / portieren / streichen | Begründung`; Abschnitt „NGX→FFX-Mapping" (welche NGX-Parameter auf welche `ffxDispatchDescUpscale`-Felder), Abschnitt „Build" (CMake, Abhängigkeiten: ReShade-Addon-Header, FidelityFX SDK 2.3, MinHook, imgui), Abschnitt „Output-Modi" (FSR-AA, Spatial, Proxy-Swapchain) mit Meilensteinen M1–M6.
- Dateien: neu `fsr-feeder/DESIGN.md`, `.gitignore` (nur `vendor/` ist schon drin – nichts ändern nötig).
- Akzeptanz: Datei ≥ 200 Zeilen; Test `test/fsr-feeder-design.test.js` prüft, dass jede `.cpp/.h/.hpp`-Datei unter `vendor/dlss5-feeder/src` (falls vorhanden) in der Tabelle vorkommt, sonst wird der Test übersprungen-los als „Vendor fehlt" **bestanden**. Guard grün.
- retries: 0

### [ ] 3.2 CMake-Skelett + FFX-Upscale-Wrapper (kompilierbar) — `[!]` blockiert bis H2 (MSVC) erledigt
- depends: 3.1, H2
- Ziel: `fsr-feeder/CMakeLists.txt`, `fsr-feeder/src/ffx_upscaler.{h,cpp}` (Context-Erzeugung, Dispatch, Backend-Auswahl FSR4-DLL-lokal/FSR3.1), Smoke-Test-Host ohne ReShade, der einen Frame durch FSR 3.1 schickt.
- Akzeptanz: `cmake --build` erfolgreich, Smoke-Host Exit 0. (Guard kann das nicht prüfen → Mensch verifiziert.)
- retries: 0

---

## Mensch-Aufgaben (Loop überspringt)

### [h] H1 Phase-0-Spikes S1–S8 auf dem PC durchführen, Ergebnisse in `../AMD-Upscaling-Plan.md` Abschnitt 4 / `loop/SPIKES.md` eintragen
### [h] H2 Visual Studio Build Tools 2022 (C++-Workload + Windows SDK) installieren → schaltet 3.2 frei (Heading dann auf `[ ]` setzen)
### [h] H3 Obsidian: `FG-Wpc/upscaler-swapper/node_modules` unter „Dateien & Links → Ausgeschlossene Dateien" eintragen
### [h] H4 DLSS-NR-on-AMD-Autor kontaktieren (Silent-Switch, Erlaubnis zur Erkennung/Verlinkung) → Phase 4
### [h] H5 Entscheidungen 1–5 aus dem Plan (Fork/Neubau, FSR-Feeder als eigenes Repo, NR ja/nein, Ziel-GPUs, Branding)
### [h] H6 Nach Spike S2 ein echtes `OptiScaler.log` nach `test/fixtures/optiscaler-log-real.txt` legen (Parser-Muster aus 1.8 bestätigen)
### [h] H7 `[v]`-Aufgaben prüfen und auf `[x]` setzen; bei Bedarf `node scripts/loop-baseline.js` neu laufen lassen und committen
