# Aufgabenliste: AMD-Port (Loop-Queue) — Drei-Stufen-Architektur

Legende im Heading: `[ ]` offen · `[~]` in Arbeit · `[v]` vom Guard verifiziert, wartet auf Abnahme · `[x]` vom Menschen akzeptiert · `[!]` blockiert (Begründung im Heading) · `[h]` Mensch-Aufgabe, Loop überspringt.

Jede Aufgabe: `depends`, Ziel, Dateien, **Akzeptanz** (maschinell prüfbar), Grenzen, `retries`. Akzeptanzkriterien ändert nur der Mensch.

## Die Architektur in drei Sätzen

Das Werkzeug ist ein **Weichensteller**. Es erkennt pro Spiel die Engine und die vorhandenen Upscaler und wählt daraus die bestmögliche der drei Stufen. Stufe 1 ist OptiScaler auf vorhandene Upscaler-Eingänge, Stufe 2 ist die Engine per Config dazu bringen, ihren Upscaler-Steckplatz freizugeben, Stufe 3 ist räumliches Upscaling plus Frame Generation über Treiber und externe Werkzeuge.

| Stufe | Bedingung | Ergebnis |
|---|---|---|
| 1 | Spiel hat DLSS, FSR 2+, XeSS | FSR 4.1, volle Qualität |
| 2 | Spiel hat TAA, kein Upscaler, Engine mit Upscaler-Steckplatz (Unreal) | FSR 4.1, volle Qualität |
| 3 | kein TAA oder keine Engine-Unterstützung oder Anti-Cheat | räumlich + Frame Generation |

## Gesicherte Fakten (nicht neu recherchieren)

- Referenz-PC: RX 7900 XT (RDNA3), Adrenalin 26.8.1, Treiber 32.0.31041.1004, Windows 11. `amdxcffx64.dll` 2.3.0.3193 im DriverStore. Kein MSVC installiert, also **kein C++ in diesem Loop**.
- FSR 4.1 auf RDNA3 offiziell ab Adrenalin 26.6.2 (Desktop-dGPU). RDNA4 immer. RDNA2 erst 2027. Mobile RDNA3/3.5 nein.
- OptiScaler 0.9.4: `https://github.com/optiscaler/OptiScaler/releases/download/v0.9.4/Optiscaler_0.9.4-final.20260718._MM.7z`, 55 016 448 Bytes, **7z**. Enthält fakenvapi 1.4.1 und Nukem dlssg-to-fsr3 0.130. Hooks: `dxgi.dll` (DX11/12), `winmm.dll` (Vulkan), Alternativen `version.dll`, `dbghelp.dll`. GPL-3.0.
- Unreal-Steckplatz: `r.TemporalAA.Upscaler=1` aktiviert den Upscaler-Plugin-Pfad, `r.AntiAliasingMethod` wählt das Verfahren, `r.ScreenPercentage` und `r.ScreenPercentage.MinResolution` setzen die Renderauflösung. Quelle: OptiScaler-Wiki „Unreal Engine Tweaks".
- FSR 2+ ersetzt das TAA des Spiels und braucht dieselben Eingänge: jitterte Farb- und Tiefenbilder plus nicht-jitterte Bewegungsvektoren. Quelle: FidelityFX-FSR2 README.
- Magpie macht bewusst kein FSR 2/3, weil Nachbearbeitung ohne Engine-Integration nicht geht. Das ist die Begründung für Stufe 3 und wird nicht angezweifelt.
- Der i18n-Test verlangt jeden neuen `feature-i18n`-Key in **allen 38 Sprachen** mit identischen Platzhaltern.
- Testmuster: `node:test`, temporäre Ordner via `fs.mkdtempSync`, injizierbare Runner. Vorbilder: `test/driver-barrier.test.js`, `test/apply-feeder64.test.js`, `test/gpu-detect.test.js`.
- GitHub: Fork `HenrikBrehm/DLSS5-Swapper-AMD`, Remote `fork`, Branch `amd-port`. `origin` ist auf `no_push` gesperrt und bleibt es.

---

## Phase 1 — Fundament und Stufe 1

### [v] 1.1 GPU-Erkennung generisch (`src/core/gpu-detect.js`) — commit: 9e79cf5

### [v] 1.2 `install-guards.js` an gpu-detect anbinden — commit: ac93b35
- depends: 1.1
- Ziel: `gpuInfo()` nutzt `gpu-detect.detect()`. Rückgabe bleibt für NVIDIA-Zeilen formgleich (`{name, driver, ...}`), damit `driverNeuralFault`, `driverNames`, `gpuSupported`, `driverSupported` unverändert funktionieren. Neue Exporte: `vendorOf(rows)` → `'amd'|'nvidia'|'intel'|'mixed'|'unknown'` (mixed nur bei mehreren Vendoren mit Anzeigeadapter), `amdRow(rows)` → die erste AMD-Zeile oder null, `amdFsr4Ready(rows)` → bool.
- Dateien: `src/core/install-guards.js`, neu `test/install-guards-vendor.test.js`, `test/driver-barrier.test.js` nur erweitern.
- Akzeptanz: alle bestehenden Tests grün; ≥ 6 neue Tests (nur AMD, nur NVIDIA, gemischt, keine GPU, fsr4Ready true/false). Guard grün.
- Grenzen: `driverNeuralFault` reagiert weiterhin ausschließlich auf NVIDIA-Zeilen.
- retries: 0

### [v] 1.3 Scan: Upscaler-Inventar pro Spiel (`target.upscalers`) — commit: e296c37
- depends: –
- Ziel: `scan.js` ergänzt pro Ziel `upscalers = { dlss, dlssg, fsr2, fsr31, fsr31Signed, xess, streamline, any }`. Dateinamen im Exe-Ordner und bis zwei Ebenen darunter: DLSS `nvngx_dlss.dll`; DLSS-FG `nvngx_dlssg.dll`, `sl.dlss_g.dll`; Streamline `sl.interposer.dll`; FSR2 `ffx_fsr2_api_x64.dll`, `ffx_fsr2_api_dx12_x64.dll`, `ffx_fsr2_api_vk_x64.dll`; FSR3.1 `amd_fidelityfx_dx12.dll`, `amd_fidelityfx_vk.dll`, `amd_fidelityfx_upscaler_dx12.dll`, `ffx_fsr3upscaler_x64.dll`; XeSS `libxess.dll`, `libxess_dx11.dll`. `fsr31Signed` über injizierbaren `isSigned(file)`-Callback, Default PowerShell `Get-AuthenticodeSignature`, nur bei vorhandener FSR3.1-DLL aufgerufen, in Tests immer gestubbt. `any` = mindestens einer von dlss/fsr2/fsr31/xess.
- Dateien: `src/core/scan.js` ergänzen, neu `test/scan-upscalers.test.js`.
- Akzeptanz: ≥ 7 Tests (nur DLSS, DLSS+FG, FSR3.1 signiert, FSR3.1 unsigniert, XeSS, nichts, verschachtelt zwei Ebenen tief); bestehende Scan-Tests grün; `upscalers` immer ein Objekt. Guard grün.
- Grenzen: `primaryDlss` und `hasNativeDlss` nicht verändern.
- retries: 0

### [v] 1.4 Engine-Erkennung (`src/core/engine-detect.js`) — commit: cf90cbc
- depends: –
- Ziel: `detectEngine(gameDir, exePath)` → `{ engine, version, projectName, configDir, upscalerSlot }`. Engines: `unreal` (Ordner `Engine/Binaries/Win64`, oder ein Unterordner mit `Content/Paks`, oder Exe endet auf `-Win64-Shipping.exe`; `projectName` = der Ordner mit `Content/Paks`; Version aus `Engine/Build/Build.version` falls vorhanden, sonst aus der Exe-Dateiversion), `unity` (`UnityPlayer.dll` oder `<Name>_Data/globalgamemanagers`), `re-engine` (`re_chunk_000.pak`), `creation` (`*.esm` und Ordner `Data`), `source` (`bin/engine.dll` oder `*.vpk`), `idtech` (`base/*.resources`), `godot` (`*.pck` neben der Exe), `cryengine` (`CrySystem.dll`), sonst `unknown`. `upscalerSlot` ist `true` nur für `unreal`. `configDir` für Unreal: `%LOCALAPPDATA%\<projectName>\Saved\Config\Windows` bzw. `WindowsNoEditor`, über injizierbares `localAppData`.
- Dateien: neu `src/core/engine-detect.js`, neu `test/engine-detect.test.js`.
- Akzeptanz: ≥ 10 Tests, je ein Ordner-Fixture pro Engine plus `unknown`, plus Unreal mit `WindowsNoEditor`-Variante und Unreal ohne `Content/Paks`. Kein echter Dateisystemzugriff außerhalb von `mkdtempSync`. Guard grün.
- Grenzen: nichts schreiben, reine Erkennung.
- retries: 0

### [v] 1.5 Routen-Registry und vendor-abhängiges `routesFor` — commit: 75a81da
- depends: 1.2, 1.3, 1.4
- Ziel: `src/shared/install-routes.js`: `routesFor(target, api, gpu)`. Ohne `gpu` exakt das heutige Verhalten. Mit `gpu.vendor === 'amd'`: `amd-optiscaler` wenn 64-Bit, kein Emulator, api in `dxgi`/`vulkan`, nicht DX10, und `upscalers.any`; `engine-upscale` wenn 64-Bit, `engine.upscalerSlot`, `!upscalers.any`; `amd-driver` immer wenn api nicht `d3d8`/`ddraw`; `spatial` immer. Niemals `native`/`feeder`/`renodx`/`optiscaler` auf AMD. Neuer Export `routeMeta(route)` → `{ vendor, tier, label, needsGpu }`. `backend-manager.js`: Routen-Whitelist in `profileFile()` und `configPaths()` um `amd-optiscaler` (Config `OptiScaler.ini`), `engine-upscale` (Config `OptiScaler.ini`), `amd-driver` und `spatial` (keine Dateien) ergänzen.
- Dateien: `src/shared/install-routes.js`, `src/core/backend-manager.js`, `test/install-routes.test.js` erweitern, neu `test/install-routes-amd.test.js`.
- Akzeptanz: bestehende Tests grün; ≥ 10 neue Tests inkl. „ohne gpu unverändert", Unreal ohne Upscaler → `engine-upscale`, Unity ohne Upscaler → kein `engine-upscale`, DX11 32-Bit → nur `amd-driver`/`spatial`. Guard grün.
- Grenzen: `optiReason()` unverändert lassen.
- retries: 0

### [v] 1.6 OptiScaler upstream als Komponente (7z, Pinning, Payload-Prüfung) — commit: 5b9c971
- depends: –
- Ziel: `src/core/optiscaler-upstream.js` mit gepinntem Release 0.9.4 (URL siehe oben, SHA-256 beim ersten Download berechnen und eintragen, GPL-3.0-Text separat laden und prüfen). Entpacken über npm-Paket `7zip-bin` plus `child_process`, kein weiteres neues Paket. Nach dem Entpacken `loop/optiscaler-0.9.4-files.txt` mit Dateiliste und Größen ins Repo schreiben, daraus `validateUpstreamPayload(root)` ableiten. `ensureOptiScalerUpstream(cacheRoot)` analog zu `ensureOptiScaler`. `THIRD_PARTY_NOTICES.md` um OptiScaler upstream, fakenvapi, Nukem und 7zip-bin ergänzen. Das Archiv landet in `tools/` und ist damit gitignored.
- Dateien: neu `src/core/optiscaler-upstream.js`, `package.json` (nur `7zip-bin`), `package-lock.json`, `THIRD_PARTY_NOTICES.md`, neu `loop/optiscaler-0.9.4-files.txt`, neu `test/optiscaler-upstream.test.js`, neu `test/fixtures/optiscaler-0.9.4.ini` (echte INI aus dem Archiv, unverändert).
- Akzeptanz: ≥ 6 Tests mit Fake-Payload-Ordnern (vollständig, Datei fehlt, 32-Bit-DLL → `errOptiPayload`, Hash-Mismatch → `componentChecksum`); Entpacken in Tests gestubbt; Fixture-INI ≥ 100 Zeilen. Guard grün, insbesondere keine Binärdatei im Index.
- Grenzen: `optiscaler.js` (NVIDIA-Fork) nicht anfassen.
- retries: 0

### [v] 1.7 AMD-Konfigurator `configureAmd()` — commit: 0644b96
- depends: 1.6
- Ziel: `configureAmd(iniText, target, gpu, options)` in `optiscaler-upstream.js`. Options `{ output: 'fsr4'|'fsr31'|'xess', inputs: 'dxgi-spoof'|'fakenvapi'|'none', fg: 'none'|'nukem'|'optifg'|'fsrfg'|'xefg' }`. Es dürfen **nur** Schlüssel gesetzt werden, die in `test/fixtures/optiscaler-0.9.4.ini` vorkommen; ein Test erzwingt das. Schlüssel und Werte stehen unten und sind aus der echten INI abgelesen, nicht geraten.
- **Die echten Schlüssel und ihre Werte** (aus `test/fixtures/optiscaler-0.9.4.ini`, Kommentare dort sind maßgeblich):
  - `[Upscalers] Dx12Upscaler`: `xess, fsr21, fsr22, fsr31, dlss`. **FSR 4 läuft über `fsr31`**, dort steht wörtlich „fsr31 (also for FSR4)".
  - `[Upscalers] Dx11Upscaler`: `fsr22, fsr31, xess, xess_12, fsr21_12, fsr22_12, fsr31_12, dlss`. Für FSR 4: **`fsr31_12`** („dx11on12, FSR4").
  - `[Upscalers] VulkanUpscaler`: `fsr21, fsr22, fsr31, xess, fsr21_12, fsr31_12, dlss`. Für FSR 4: **`fsr31_12`** („VKon12, FSR4").
  - `[FSR] Fsr4Update`: `true`/`false`, Standard „depends on GPU - true for RDNA4". Auf **RDNA3 also ausdrücklich `true` setzen**.
  - `[FSR] Fsr4ForceEnableInt8`: `true`/`false`, Standard `false`, Kommentar „Enables INT8 model for all GPUs". Auf **RDNA3 `true`**, das ist der eigentliche Schalter für die 7000er-Reihe.
  - `[FSR] FsrAgilitySDKUpgrade`: nur für Windows 10 relevant, auf Windows 11 nicht anfassen.
  - `[Spoofing] Dxgi`: Standard ist bereits „true for AMD/Intel", also nur bei `inputs === 'none'` ausdrücklich auf `false` setzen.
  - `[Spoofing] StreamlineSpoofing`: Standard `true`, erlaubt fakenvapi ohne vollständiges Spoofing.
  - `[FrameGen] Enabled`: `true`/`false`, Standard `false`.
  - `[FrameGen] FGInput`: `nofg, dlssg, nukems, fsrfg, upscaler, fsrfg30`. Für OptiFG ist der Wert **`upscaler`**, nicht „optifg".
  - `[FrameGen] FGOutput`: `nofg, fsrfg, xefg, nukems`.
  - `[Inputs] EnableDlssInputs`, `EnableFsr2Inputs`, `EnableFsr3Inputs`, `EnableXeSSInputs`: Standard `true`.
  - `[Log] LogToFile`, `LogLevel`, `LogFileName`: für den Verify-Schritt aus 1.9 auf `true` / `2` / fester Name.
  - `[Plugins] LoadAsiPlugins`: auf `false`, damit fremde ASI-Plugins nicht mitgeladen werden.
  - `[ProcessFilter] TargetProcessName`: existiert upstream und nimmt den Exe-Namen, damit die Proxy-DLL nicht in Launcher injiziert.
  - **Nicht vorhanden und daher verboten**: `DlssNr`, `Fsr4Enable`, `UpscalerOutput`, `AntiLag2`. Anti-Lag 2 kommt von fakenvapi, nicht aus dieser INI.
- Defaults: `output` = `fsr4` wenn `gpu.fsr4Capable`, sonst `fsr31`. `inputs` = `dxgi-spoof` wenn nur DLSS vorhanden ist, sonst `none`. `fg` = `none`, bis 4.1 existiert.
- Dateien: `src/core/optiscaler-upstream.js`, `test/optiscaler-upstream.test.js` erweitern.
- Akzeptanz: ≥ 9 Tests (Defaults RDNA2/3/4, jede Option, Schlüssel-Existenz gegen die Fixture, Idempotenz, RDNA3 setzt beide FSR4-Schalter). Guard grün.
- Grenzen: keine Schlüssel erfinden. Fehlt ein gewünschter Schalter, in STATE.md notieren und weglassen.
- retries: 0

### [v] 1.8 Route `amd-optiscaler` — commit: 71c31fb
- depends: 1.5, 1.7
- Ziel: `src/core/routes/amd-optiscaler.js` mit `install(config, log)` analog `optiscaler.install`. Manifest `route: 'amd-optiscaler'`. Copy-Plan aus dem Upstream-Layout: `OptiScaler.dll` unter dem Hook-Namen je API, `fakenvapi.dll` und `.ini` nur bei `inputs === 'fakenvapi'`, Nukem-DLL nur bei `fg === 'nukem'`, FFX- und XeSS-Bibliotheken, Lizenzen nach `OptiScaler/licenses/`. `OptiScaler.ini` über `configureAmd`. Konfliktprüfung über `optiscaler.checkConflicts`. `backend-manager.install()` verzweigt auf die neue Route.
- Dateien: neu `src/core/routes/amd-optiscaler.js`, `src/core/backend-manager.js`, neu `test/apply-amd-optiscaler.test.js`.
- Akzeptanz: ≥ 7 Tests: Install DX12, Install Vulkan (Hook `winmm.dll`), fakenvapi-Option, Nukem-Option, Konflikt mit fremder `dxgi.dll` → `errOptiConflict`, Restore stellt den Ordner byte-identisch her (SHA-256 aller Dateien vorher/nachher), Reinstall idempotent. Guard grün.
- Grenzen: `apply.js` höchstens um Exporte bestehender Helfer erweitern.
- retries: 0

### [v] 1.9 Verify: OptiScaler-Log auswerten — commit: 8ec7b46
- depends: 1.8
- Ziel: `src/core/verify.js` mit `parseOptiScalerLog(text)` → `{ upscaler, fsr4, int8, fg, errors }` und `verifyInstall(gameDir, exePath, route)` → `{ state: 'ok'|'no-log'|'failed', details }`. IPC-Handler `verify-install` in `main.js`, Badge im Renderer. Neue i18n-Keys `verifyOk`, `verifyNoLog`, `verifyFailed`, `verifyHint` in allen 38 Sprachen.
- Dateien: neu `src/core/verify.js`, `main.js`, `src/renderer/renderer.js`, `src/shared/feature-i18n.js`, neu `test/verify.test.js`, neu `test/fixtures/optiscaler-log-synthetic.txt`.
- Akzeptanz: ≥ 7 Parser-Tests; i18n-Test grün. Guard grün.
- Grenzen: Die Log-Muster sind eine Hypothese, bis der Mensch ein echtes Log liefert (H6). Im Code als solche kommentieren.
- retries: 0

### [v] 1.10 UI und i18n für die AMD-Routen — commit: 9d0bc44
- depends: 1.8
- Ziel: Routenauswahl zeigt auf AMD `FSR 4 via OptiScaler`, `Engine-Upscaling`, `AMD-Treiber (geführt)`, `Räumlich (Fallback)`. Der Bestätigungsdialog in `main.js` ist vendor-abhängig: auf AMD Adrenalin-Version, FSR-4-Fähigkeit und Anti-Cheat-Hinweis, keine Blackwell- oder 616.56-Texte. Neue Keys in allen 38 Sprachen.
- Dateien: `main.js`, `src/renderer/renderer.js`, `src/renderer/index.html`, `src/shared/feature-i18n.js`, `test/feature-i18n.test.js` erweitern, neu `test/amd-dialog.test.js`.
- Akzeptanz: i18n-Test grün; ≥ 5 Tests für Dialoginhalte (AMD fsr4-fähig, AMD nicht fähig, NVIDIA unverändert, keine GPU). Guard grün.
- Grenzen: NVIDIA-Dialoge byte-identisch lassen.
- retries: 0

## Phase 2 — Stufe 2: Engine-Config (der neue Kern)

### [v] 2.1 Unreal-Config-Schreiber (`src/core/engine-tweaks/unreal.js`) — commit: a3dd371
- depends: 1.4
- Ziel: `plan(engine, options)` → Liste `{ file, section, key, value }` und `apply(manifest, gameDir, engine, options, io)`. Zielort: `Engine.ini` im `configDir` aus 1.4, Abschnitt `[SystemSettings]`. Schlüssel: `r.TemporalAA.Upscaler=1`, `r.AntiAliasingMethod` (Default 2 für TAA-Pfad), `r.ScreenPercentage` aus `options.renderScale` (50–100), `r.ScreenPercentage.MinResolution=0`. Read-only-Attribut vor dem Schreiben entfernen und im Manifest merken, damit Restore es zurücksetzt. Original über `trackBeforeWrite` sichern. Existiert die Datei nicht, wird sie angelegt und als `added` verbucht.
- Dateien: neu `src/core/engine-tweaks/unreal.js`, neu `test/engine-tweaks-unreal.test.js`.
- Akzeptanz: ≥ 8 Tests: neue Datei anlegen, bestehende Datei ergänzen ohne fremde Abschnitte zu verlieren, vorhandenen Schlüssel überschreiben, read-only-Datei, Restore stellt Originalinhalt und Attribut wieder her, Idempotenz, `renderScale` außerhalb 50–100 wird abgelehnt, kein `configDir` → aussagekräftiger Fehler. Guard grün.
- Grenzen: nur `[SystemSettings]` anfassen, keine anderen Abschnitte umschreiben.
- retries: 0

### [v] 2.2 Route `engine-upscale` — commit: 135b553
- depends: 2.1, 1.8
- Ziel: `src/core/routes/engine-upscale.js`: erst `unreal.apply()`, dann dieselbe OptiScaler-Installation wie `amd-optiscaler`, aber mit `inputs: 'none'` als Default, weil die Engine die Eingänge selbst liefert. Ein Manifest, das beides umfasst; Restore macht beides rückgängig. Warnhinweis im Log, dass die Engine-Config global für das Spiel gilt.
- Dateien: neu `src/core/routes/engine-upscale.js`, `src/core/backend-manager.js`, neu `test/apply-engine-upscale.test.js`.
- Akzeptanz: ≥ 6 Tests: Install schreibt Engine.ini **und** die OptiScaler-Dateien, Restore entfernt beides byte-identisch, Nicht-Unreal-Ziel wird abgelehnt, Reinstall idempotent, Wechsel von `engine-upscale` zu `amd-optiscaler` räumt die Engine.ini auf. Guard grün.
- retries: 0

### [v] 2.3 Andere Engines ehrlich melden — commit: 56a990b
- depends: 1.4
- Ziel: `src/core/engine-tweaks/index.js` mit `supportFor(engine)` → `{ supported: bool, reason: i18nKey }`. Unreal unterstützt. Unity, RE Engine, Source, id Tech, Godot, CryEngine, unknown: nicht unterstützt, mit je eigener Begründung (z.B. Unity Built-in Render Pipeline liefert keine Bewegungsvektoren). Diese Begründung erscheint im UI statt einer stummen Verweigerung. Keys in allen 38 Sprachen.
- Dateien: neu `src/core/engine-tweaks/index.js`, `src/shared/feature-i18n.js`, `src/renderer/renderer.js`, neu `test/engine-support.test.js`.
- Akzeptanz: ≥ 8 Tests, jede Engine einmal, i18n-Test grün. Guard grün.
- retries: 0

## Phase 3 — Stufe 3: Treiber und räumlicher Fallback

### [v] 3.1 Route `amd-driver` (geführt) — commit: 09b2f5d
- depends: 1.5
- Ziel: `src/core/routes/amd-driver.js` mit `steps(target, gpu, engine)` → `{ id, i18nKey, applies }` für `fsr4Toggle` (nur `upscalers.fsr31Signed && DX12 && gpu.fsr4Capable`), `afmf` (außer DX8/DirectDraw), `rsr`, `antiLag2`, `optiscalerFallback` (Vulkan mit FSR3.1, weil der Treiber-Override dort nicht greift). `install()` legt **keine** Datei im Spiel an, sondern nur ein Manifest mit `route: 'amd-driver'` und leerer Checkliste; `restore` entfernt nur das Manifest. Adrenalin öffnen über `shell.openPath` auf `%ProgramFiles%\AMD\CNext\CNext\RadeonSoftware.exe`, falls vorhanden.
- Dateien: neu `src/core/routes/amd-driver.js`, `src/core/backend-manager.js`, `src/shared/feature-i18n.js`, neu `test/amd-driver.test.js`.
- Akzeptanz: ≥ 7 Tests (Schritte je Fall, kein Dateisystem-Eingriff im Spielordner, Manifest-Roundtrip, Restore, i18n grün). Guard grün.
- retries: 0

### [v] 3.2 Route `spatial` (räumlicher Fallback) — commit: e62ba0a
- depends: 3.1
- Ziel: `src/core/routes/spatial.js`: berechnet aus der Monitorauflösung sinnvolle Renderauflösungen (Quality 67 %, Balanced 59 %, Performance 50 %) und liefert die Schrittliste: Spiel auf diese Auflösung stellen, dann RSR im Treiber für Vollbild oder Magpie für randloses Fenster. Magpie wird **nicht** mitgeliefert, nur erkannt (`%ProgramFiles%\Magpie`, `%LOCALAPPDATA%\Programs\Magpie`) und verlinkt. Auch hier keine Dateiänderung im Spiel.
- Dateien: neu `src/core/routes/spatial.js`, `src/core/backend-manager.js`, `src/shared/feature-i18n.js`, neu `test/spatial.test.js`.
- Akzeptanz: ≥ 6 Tests (Auflösungsrechnung für 1080p/1440p/2160p, Magpie gefunden/nicht gefunden, kein Dateisystem-Eingriff, i18n grün). Guard grün.
- Grenzen: nichts herunterladen, nichts starten außer auf ausdrückliche Nutzeraktion.
- retries: 0

### [v] 3.3 Anti-Cheat auf AMD führt ausschließlich zu Treiber- und Spatial-Routen — commit: 6d17f08
- depends: 3.1, 3.2
- Ziel: `routesFor` liefert bei `compatibility.hasAntiCheat` auf AMD nur `amd-driver` und `spatial`. Der Anti-Cheat-Bestätigungsdialog entfällt dort, weil nichts injiziert wird.
- Dateien: `src/shared/install-routes.js`, `main.js`, `test/install-routes-amd.test.js` erweitern.
- Akzeptanz: ≥ 4 Tests. Guard grün.
- retries: 0

## Phase 4 — Frame Generation

### [v] 4.1 FG-Planer (`src/core/fg-plan.js`) — commit: 4a7ee78
- depends: 1.3
- Ziel: `planFrameGen({ api, apiLabel, bitness, upscalers, gpu, route })` → `{ fg, note }`. Regeln: natives FSR3-FG vorhanden → `native`; DLSS-FG vorhanden und DX12 oder Vulkan → `nukem`; DX12 ohne FG und Route ist OptiScaler-basiert → `optifg`; sonst → `afmf`. RDNA3 bekommt nie `fsr4-fg`.
- Dateien: neu `src/core/fg-plan.js`, neu `test/fg-plan.test.js`.
- Akzeptanz: tabellengetriebener Test mit ≥ 14 Fällen. Guard grün.
- retries: 0

### [~] 4.2 FG-Auswahl in Routen und UI
- depends: 4.1, 1.8, 2.2
- Ziel: Der Default für `options.fg` in `amd-optiscaler` und `engine-upscale` kommt aus `planFrameGen`. Der Renderer bietet die Auswahl mit vorbelegter Empfehlung und zeigt die Begründung. Keys in allen 38 Sprachen.
- Dateien: `src/core/routes/amd-optiscaler.js`, `src/core/routes/engine-upscale.js`, `main.js`, `src/renderer/renderer.js`, `src/shared/feature-i18n.js`, Tests erweitern.
- Akzeptanz: ≥ 4 neue Tests. Guard grün.
- retries: 0

## Phase 5 — Weichensteller und Produktreife

### [ ] 5.1 Router (`src/core/router.js`)
- depends: 1.5, 2.3, 3.2, 4.1
- Ziel: `route(target, gpu, engine)` → `{ tier: 1|2|3, route, fg, reason: i18nKey, alternatives: [] }`. Genau eine Empfehlung plus Alternativen, immer mit Begründung. Das ist die zentrale Funktion des Werkzeugs.
- Dateien: neu `src/core/router.js`, `src/shared/feature-i18n.js`, neu `test/router.test.js`.
- Akzeptanz: tabellengetriebener Test mit ≥ 16 Fällen, der jede Zeile der Stufentabelle oben abdeckt; jede `reason` existiert in allen 38 Sprachen. Guard grün.
- retries: 0

### [ ] 5.2 Stufe im UI anzeigen
- depends: 5.1
- Ziel: Die Spielkarte zeigt die Stufe als Abzeichen, die empfohlene Route ist vorausgewählt, die Begründung steht darunter. Filter nach Stufe in der Bibliothek.
- Dateien: `src/renderer/renderer.js`, `src/renderer/index.html`, `src/renderer/style.css`, `main.js`, neu `test/router-ipc.test.js`.
- Akzeptanz: ≥ 4 Tests über den IPC-Handler. Guard grün.
- retries: 0

### [ ] 5.3 Community-Report um Vendor-Felder erweitern
- depends: 1.2, 5.1
- Ziel: Payload enthält zusätzlich `vendor`, `tier`, `route`, `upscalerOutput`, `fgType`, `adrenalinVersion` (null wenn unbekannt). Unbekannte Felder vom Server sind kein Fehler.
- Dateien: `src/community-client.js`, `main.js`, `test/community-client.test.js` erweitern.
- Akzeptanz: ≥ 4 neue Tests, bestehende grün. Guard grün.
- retries: 0

### [ ] 5.4 Diagnose-Bundle um AMD-Daten erweitern
- depends: 1.2, 1.9
- Ziel: `diagnostics.js` sammelt zusätzlich Adrenalin-Version, Pfad und Version von `amdxcffx64.dll`, die erkannte Engine und `OptiScaler.log` gekürzt auf 200 KB.
- Dateien: `src/core/diagnostics.js`, `test/diagnostics.test.js` erweitern.
- Akzeptanz: ≥ 4 neue Tests. Guard grün.
- retries: 0

### [ ] 5.5 Kompatibilitätsliste importieren
- depends: –
- Ziel: `scripts/import-compat-amd.js` lädt die OptiScaler-Wiki-Seite „FSR4 Compatibility List" als Markdown und erzeugt `src/data/compat-amd.json` mit `{ game, status, notes }`. Der Parser liegt als reine Funktion in `src/core/compat-amd.js`. Netzwerk ausschließlich im Script, nie im Test.
- Dateien: neu `scripts/import-compat-amd.js`, neu `src/core/compat-amd.js`, neu `src/data/compat-amd.json` (≤ 2 MB), neu `test/compat-amd.test.js`, neu `test/fixtures/compat-amd-sample.md`.
- Akzeptanz: ≥ 5 Parser-Tests; JSON valide mit ≥ 100 Einträgen. Guard grün.
- retries: 0

### [ ] 5.6 README und Branding
- depends: 5.2
- Ziel: `README-AMD.md` auf Deutsch und Englisch, je ≤ 200 Zeilen: was das Werkzeug tut, die drei Stufen, Voraussetzungen, was nicht geht (Anti-Cheat, RDNA2 bis 2027, Vulkan-Treiber-Override, kein echtes Upscaling ohne Bewegungsvektoren), Verify, Restore, Danksagung an Upstream und OptiScaler. Im Haupt-`README.md` ein Hinweiskasten oben, dass dies ein AMD-Fork ist, mit Link auf das Original.
- Dateien: neu `README-AMD.md`, `README.md`, `THIRD_PARTY_NOTICES.md`, neu `test/readme-amd.test.js`.
- Akzeptanz: beide Sprachen vorhanden; jede Route-ID aus `routeMeta` und jede Stufe kommt vor; Upstream-Link vorhanden. Guard grün.
- retries: 0

### [ ] 5.7 Abschlussbericht
- depends: 5.6
- Ziel: `loop/REPORT.md`: was gebaut wurde, Teststand, welche Aufgaben `[v]` sind, welche offen oder blockiert, welche Mensch-Aufgaben anstehen, und die ehrliche Einschätzung, was auf dem Referenz-PC noch verifiziert werden muss, bevor irgendetwas als funktionierend gilt.
- Dateien: neu `loop/REPORT.md`.
- Akzeptanz: Datei existiert, nennt jede Aufgaben-ID aus dieser Datei mit ihrem Endzustand. Guard grün. Danach `ScheduleWakeup(stop: true)`.
- retries: 0

---

## Mensch-Aufgaben (Loop überspringt, niemals anfassen)

### [h] H1 Spikes S1–S8 auf dem PC durchführen und in `loop/SPIKES.md` eintragen
### [h] H2 Visual Studio Build Tools installieren, falls später doch C++ gewünscht ist
### [h] H3 Obsidian: `FG-Wpc/upscaler-swapper/node_modules` von der Indizierung ausschließen
### [h] H4 Entscheiden, ob DLSS-NR-on-AMD überhaupt aufgenommen wird, und den Autor kontaktieren
### [h] H5 Branding endgültig festlegen
### [h] H6 Nach Spike S2 ein echtes `OptiScaler.log` nach `test/fixtures/optiscaler-log-real.txt` legen
### [h] H7 `[v]`-Aufgaben prüfen und auf `[x]` setzen, bei Bedarf `node scripts/loop-baseline.js` neu laufen lassen
