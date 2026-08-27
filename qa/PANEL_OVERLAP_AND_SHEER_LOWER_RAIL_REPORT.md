# Panel overlap and Sheer lower rail report

## Scope

Surgical correction on the production files used by the existing HomeEasy Studio. Baseline: `01afc861321d38b454d518e6c1a0e380c64e2c97` (`Fix Binovo end caps and Panel telo separation`). No new HTML, application, repository, visualizer, or proof of concept was created.

Only these production files changed:

- `products/panel/production/panel-japones-builder.js`
- `products/sheer/production/apply-sheer-fabric-pack.js`

Onda Serena, Placement, `index.html`, `login.html`, `ar-homeeasy-v3.html`, `production/studio-core.js`, the three product masters, the fabric packs, and the Quick Look handoff were not changed.

## Panel Japonés — physical overlap density

### Root cause

The runtime already created four separate telos, placed them on their real tracks, and calculated a true 8 cm overlap. However, the Tretto textile uses `alphaMode: MASK`; opaque yarn fragments on the front telo fully occluded the same fragments on the rear telo. With the same color on both telos, the real overlap was therefore weak in a frontal view, especially with White Black on an iPhone-sized viewport.

### Correction

The builder now calculates intersection intervals directly from the actual telo bounds. Only intervals containing two or more physical telos receive an optical-density surface, placed immediately in front of the foremost telo with an 0.08 mm clearance.

The surface is not a painted border. It:

- has exactly the real intersection width;
- inherits the real panel indices, tracks, and foremost Z order;
- uses the same Tretto Base Color, Normal, Metallic/Roughness, UV transform, Alpha texture, `alphaMode: MASK`, and `alphaCutoff` as `PANEL_FABRIC`;
- applies a 0.90 transmission factor for the second physical layer;
- is omitted where there is no actual multi-layer intersection.

For the canonical 3.00 × 2.40 m, 4-way/4-telo, White Black configuration, the measured overlap intervals are 0.08 m, 0.08 m, and 0.08 m. The primary telo geometry hash is unchanged. Closed, Partial, and Collected remain distinct and valid.

The comparison is in [PANEL_OVERLAP_DENSITY_BEFORE_AFTER.jpg](panel-visual-separation/PANEL_OVERLAP_DENSITY_BEFORE_AFTER.jpg).

## Sheer Elegance — lower aluminum profile

### Root cause

Two coincident interfaces could flicker:

- `Perfil_Inferior` and `Inserto_Perfil_Inferior` shared the same front Z plane;
- `Tela_Retorno_Inferior` and `Rodillo_Retorno_Inferior` shared the same outer radius.

In addition, `Perfil_Inferior` used a brighter satin material that did not match the approved matte headrail finish.

### Correction

- The lower insert was separated by 0.60 mm from the profile plane.
- The return textile was separated radially by 0.35 mm from the return roller.
- `Perfil_Inferior` now uses `HomeEasy_LowerRail_Matte_V23`, with the exact headrail factors: Base Color `[0.84, 0.84, 0.80, 1]`, Metallic `0.08`, Roughness `0.62`.
- The lower profile keeps double-sided rendering because the golden mesh winding requires it; its shape was not changed.

The Sheer fabric material, phase states, Binovo geometry, Standard geometry, mechanisms, control chain, and bottom profile shape remain unchanged. The comparison is in [SHEER_LOWER_RAIL_FLICKER_BEFORE_AFTER.jpg](sheer-lower-rail/SHEER_LOWER_RAIL_FLICKER_BEFORE_AFTER.jpg).

## Verification

- `node tests/panel-overlap-sheer-lower-rail-audit.mjs`: PASS.
- `node tests/binovo-panel-real-model-viewer.mjs`: PASS.
- Real HomeEasy Studio in the Codex in-app browser with local, unmodified `model-viewer 4.3.1`: PASS.
- Panel White Black: Closed, Partial, and Collected loaded; AR button enabled for all three.
- Sheer: Binovo and Standard loaded; Open, Medium, Closed and left/right control loaded.
- Product switching Sheer → Panel → Sheer → Panel: PASS.
- Exact preview GLB retained for the Quick Look request, `ios-src` absent, wall placement and fixed scale preserved: PASS.
- Console errors/warnings: 0/0.
- Khronos glTF Validator for five final representative GLBs: 0 errors, 0 warnings.

Detailed machine-readable results:

- [panel-overlap-sheer-lower-rail-audit.json](panel-overlap-sheer-lower-rail/validation/panel-overlap-sheer-lower-rail-audit.json)
- [khronos-gltf-validator.json](panel-overlap-sheer-lower-rail/validation/khronos-gltf-validator.json)
- [in-app-browser-studio.json](panel-overlap-sheer-lower-rail/validation/in-app-browser-studio.json)
- [real-model-viewer-binovo-panel.json](panel-visual-separation/validation/real-model-viewer-binovo-panel.json)

Physical Quick Look activation on an iPhone remains an external-device check; the implementation and exact-GLB handoff were not changed in this task.
