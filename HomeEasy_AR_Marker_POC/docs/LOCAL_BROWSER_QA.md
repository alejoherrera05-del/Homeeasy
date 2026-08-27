# Local browser QA

Date: 2026-08-27

This report covers the static browser lab. Camera permission, marker tracking and physical placement were deliberately not simulated; those checks remain pending on a real iPhone.

## Result

- HTTP entry point: PASS (200)
- Clean browser load: PASS
- New console errors or warnings: 0
- Exact current Onda engine loaded from `../products/onda/studio-product.js`: PASS
- Runtime GLB SHA-256: `d78a23490bfd3250ab97f6887c71929a174ca472abf8bb76e083b4792a91e3ab`
- Runtime GLB bytes: `3,700,172`
- Requested configuration: Coral White, 1.00 x 2.20 m, closed, left: PASS
- Runtime model scale: `[1, 1, 1]`
- Rail/headrail mounting point: `[0, 2.2355, -0.038]` m
- Geometry behind mounting plane: `0` m
- Wall-plane guard: PASS
- Product bounds: min `[-0.518, 0, -0.038]`, max `[0.518, 2.2355, 0.099]` m
- Portrait viewport 390 x 844: no horizontal overflow; orientation notice hidden
- Landscape viewport 844 x 390: portrait orientation notice visible; no horizontal overflow
- Camera starts automatically: NO
- Physical iPhone marker test: PENDING

The 3.6 cm total width beyond the nominal 1.00 m rail comes from the two approved end caps; neither the golden geometry nor its materials were edited.
