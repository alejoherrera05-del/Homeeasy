# HomeEasy Marker POC - notas técnicas

## Decisión

El POC usa AR.js 3.4.8 con Three.js directo y tracking de marcador tipo `pattern`. No usa A-Frame, Quick Look, WebXR, NFT, geolocalización, ARKit ni servicios externos en runtime.

AR.js publica un build Three.js para Image Tracking + Marker Tracking y permite fijar el tag en lugar de `master`. La versión 3.4.8 declara `three` 0.164.0 como dependencia. Fuentes: [release AR.js 3.4.8](https://github.com/AR-js-org/AR.js/releases/tag/3.4.8), [package.json del tag](https://github.com/AR-js-org/AR.js/blob/3.4.8/package.json) y [ejemplo Three.js oficial](https://github.com/AR-js-org/AR.js/blob/3.4.8/three.js/examples/basic.html).

## Dependencias locales

- `ar-threex-3.4.8.mjs`: asset oficial de la release 3.4.8.
- `three-0.164.0.module.min.js`: paquete Three.js 0.164.0.
- `GLTFLoader-0.164.0.js` y `BufferGeometryUtils-0.164.0.js`: ejemplos oficiales Three.js 0.164.0. El único cambio local de GLTFLoader es la ruta relativa hacia la utilidad vendorizada.
- `camera_para.dat`: parámetros oficiales incluidos en AR.js 3.4.8.

El HTML no contiene CDN. GitHub Pages entrega todo por HTTPS, requisito de `getUserMedia` en Safari.

## Marcador

El patrón se generó con la misma convención del codificador oficial `THREEx.ArPatternFile`: imagen interior de 16 x 16, cuatro rotaciones y canales BGR. Tiene rasgos asimétricos de alto contraste y una cruz central; el branding permanece fuera del área crítica.

El cuadrado negro impreso mide 0,18 m. `patternRatio=0.5` deja el patrón interior en el 50 % del marcador y el borde negro ocupa el resto. La página A4 incluye una guía de control de 18 cm.

## Anclaje y ejes

La geometría se obtiene únicamente desde `products/onda/studio-product.js` con la configuración congelada. Después de cargar el GLB:

1. Se calculan bounds de toda la geometría.
2. Se localizan `ONDA_RAIL`, tapas y soportes.
3. El mount point usa centro X, máximo Y y mínimo Z del riel.
4. Se exige `min(productZ - wallBackZ) >= -epsilon`.
5. El GLB se traslada como objeto hijo; no se editan vértices.
6. El producto +Y se mapea al -Z del plano del marcador y producto +Z al +Y normal hacia el usuario.

El grupo final conserva `scale = [1,1,1]`.

## Estados y pérdida de tracking

Los estados son `INITIALIZING`, `SEARCHING_MARKER`, `MARKER_FOUND`, `TRACKING`, `MARKER_LOST` y `ERROR`. Cuando el marcador deja de estar visible, el grupo del producto se oculta; no se mantiene un world anchor ni se deja el modelo flotando.

## Límite

Las pruebas de escritorio validan carga, contrato, transforms, tamaño y controles. Detección, distancia, jitter, escala física y recuperación solo se pueden aprobar en el iPhone real.
