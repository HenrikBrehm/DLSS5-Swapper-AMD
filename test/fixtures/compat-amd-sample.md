Excerpt from OptiScaler's Compatibility List wiki page, used as a parser
fixture. Rows are real apart from the one marked synthetic below, which
covers a status symbol the page does not currently use.
Source: https://github.com/optiscaler/OptiScaler/wiki/Compatibility-List

> :muscle: **Working** — **697**
> :skull: **Not working** — **3**
> _Last updated – 10 September 2026_

<!--
TEMPLATE FOR NEW ENTRIES
| GAME NAME | ✅/❌/➖ | DLSS/FSR3.1/XeSS | ✨ (if OptiPatcher supported, otherwise empty) | Notes go here | [#](url) |
-->

| Game | Compatibility | Upscaler <br>Inputs | OptiPatcher <br>Support | Notes | Images | 
| ---- | :-----------: | :-----------------: | :------------------------------------------------------------------: | ----- | :----: |
| [007 First Light](007-First-Light) | ✅ | DLSS |  | FSR3.1 inputs not supported, check compat entry for more info | [1](https://github.com/user-attachments/assets/ba83a9cf) |
| 1666: Amsterdam | ✅ | DLSS, FSR3.1/4, XeSS | ✨ | Using FSR4 through XeSS or DLSS inputs requires enabling `Non-Linear Color Space` to avoid black screens and flickering. | [1](https://github.com/user-attachments/assets/228077bc) |
| [171](171) | ✅ | DLSS, FSR3 | ✨ |  |  |
| [7 Days To Die](7-Days-to-Die) | ✅ | DLSS |  | Make sure **EAC** is disabled. | [1](https://github.com/user-attachments/assets/da4e6e92) <br>🐧[1](https://github.com/user-attachments/assets/40f725dc) |
| 63 Days | ✅ | XeSS |  |  | [1](https://github.com/user-attachments/assets/54fdc2bc) |
| Atlas Fallen: Reign Of Sand | ❌ |  |  | OptiScaler cannot hook this game's FSR2 inputs in DX12 or Vulkan. |  |
| EA Sports WRC | ❌ |  |  | EA Anti-cheat blocks unknown .dlls |  |
| Gears of War: Reloaded | ❌ |  |  | EAC. Game has FSR3.1, but no FSR dll. |  |
| A Synthetic Entry On One OS | ➖ | DLSS, FSR3.1/4 | ✨ | Works on Windows, not on Linux. |  |
| The Lord of the Rings: Return to Moria™ | ✅ | DLSS |  | Use the -dx12 launch option. |  |
