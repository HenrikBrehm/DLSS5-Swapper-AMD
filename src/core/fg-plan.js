'use strict';
// Which frame generation a game should get, and why.
//
// There are four answers and they are not interchangeable. Ranked by how
// much the method knows about the game:
//
//   native  - the game generates its own frames. It has the depth buffer,
//             the motion vectors and the UI, so nothing added from outside
//             can beat it. Leave it alone.
//   nukem   - the game has DLSS frame generation. Those calls can be
//             answered with FSR instead, which keeps the game's own inputs.
//   optifg  - nothing in the game, so frames are generated from the
//             upscaler's output. Works, but the UI is guesswork and usually
//             needs a HUD fix.
//   afmf    - the driver does it, outside the game entirely. Works on
//             everything including OpenGL and DirectX 9, knows nothing about
//             the game, and is the honest answer when nothing better exists.
//
// Frame generation tolerates estimated motion in a way upscaling does not:
// an error lives one frame and is gone. That is why the driver-level answer
// is genuinely useful here while the equivalent for upscaling is not.
const OPTISCALER_ROUTES = Object.freeze(['amd-optiscaler', 'engine-upscale']);

// What each answer means for OptiScaler's own configuration. `native` and
// `afmf` happen outside it entirely, so it is told to do nothing.
const CONFIGURE_AS = Object.freeze({
  native: 'none', nukem: 'nukem', optifg: 'optifg', afmf: 'none'
});
const NOTES = Object.freeze({
  native: 'fgNoteNative', nukem: 'fgNoteNukem', optifg: 'fgNoteOptiFg', afmf: 'fgNoteAfmf'
});

function planFrameGen(input) {
  // Read rather than destructured with defaults: a default only fills in for
  // undefined, and these arrive as null often enough - an unscanned game, a
  // machine with no adapter detected - that it is worth not crashing on.
  const { api, apiLabel, route } = input || {};
  const upscalers = (input && input.upscalers) || {};
  const gpu = (input && input.gpu) || {};
  const dx12 = api === 'dxgi' && apiLabel === 'DirectX 12';
  const vulkan = api === 'vulkan';

  let fg;
  if (upscalers.fsrfg) {
    // The game already does it, with everything we would have to guess at.
    fg = 'native';
  } else if (upscalers.dlssg && (dx12 || vulkan)) {
    fg = 'nukem';
  } else if (dx12 && OPTISCALER_ROUTES.includes(route)) {
    fg = 'optifg';
  } else {
    fg = 'afmf';
  }

  return {
    fg,
    configureAs: CONFIGURE_AS[fg],
    note: NOTES[fg],
    // The machine-learning frame generation is RDNA4 hardware. On an RX 7000
    // the same option runs the FSR 3 generator, and saying otherwise would
    // promise something the card cannot do.
    mlFrameGen: fg === 'optifg' && gpu.rdnaGen >= 4
  };
}

module.exports = { planFrameGen, CONFIGURE_AS, NOTES, OPTISCALER_ROUTES };
