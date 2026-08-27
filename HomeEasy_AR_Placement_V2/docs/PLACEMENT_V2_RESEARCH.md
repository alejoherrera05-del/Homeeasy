# Placement V2 — investigación técnica

Fecha de verificación: 2026-08-27.

## Conclusión

La ruta web con mayor fidelidad disponible para este piloto es generar el USDZ desde el GLB exacto ya construido para el preview y añadir una capa raíz USD con el esquema preliminar de anclaje de Apple. El laboratorio conserva el flujo vigente como control A/B; no cambia `ar-homeeasy-v3.html` ni los productos golden.

## Hallazgos verificados

- En `<model-viewer>`, `ar-placement="wall"` se transmite a WebXR y Scene Viewer. En la ruta automática de Quick Look, el exportador genera USDZ pero no añade un equivalente de anclaje vertical. El comportamiento está registrado en el issue abierto [google/model-viewer #3989](https://github.com/google/model-viewer/issues/3989) y se confirma en el [código AR de model-viewer](https://github.com/google/model-viewer/blob/master/packages/model-viewer/src/features/ar.ts).
- Apple documenta `Preliminary_AnchoringAPI` para prims anclables en el nivel raíz. Para una superficie vertical se usan `preliminary:anchoring:type = "plane"` y `preliminary:planeAnchoring:alignment = "vertical"`. El centro del ancla coincide con el origen del prim. Fuentes: [Preliminary_AnchoringAPI](https://developer.apple.com/documentation/usd/preliminary-anchoringapi), [anchoring type](https://developer.apple.com/documentation/usd/preliminary-anchoring-type), [plane alignment](https://developer.apple.com/documentation/usd/preliminary-planeanchoring-alignment) y [placing a prim in the real world](https://developer.apple.com/documentation/usd/placing-a-prim-in-the-real-world).
- USDZ exige un ZIP sin cifrado; los archivos deben empezar en offsets alineados a 64 bytes y la primera entrada USD actúa como capa por defecto. Fuente: [OpenUSD — USDZ File Format Specification](https://openusd.org/release/spec_usdz.html).
- Safari activa Quick Look desde un enlace `rel="ar"` que contenga una imagen o `picture`. Fuente: [WebKit — Viewing Augmented Reality Assets in Safari for iOS](https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/).

## Arquitectura aplicada

1. Cada motor aprobado construye el GLB configurado.
2. El mismo GLB se asigna al único `<model-viewer>` del laboratorio.
3. `model-viewer 4.3.1` genera el USDZ de presentación desde esa escena exacta.
4. `quicklook-placement-v2.js` calcula los bounds del GLB, localiza el cabezal o riel y valida el plano posterior. X e Y provienen del centro superior del componente fijo; Z usa el mínimo de toda la geometría visible para impedir que una cadena, cordón o herraje quede detrás del muro.
5. Se crea `placement.usda` como primera capa del paquete. Su prim raíz aplica `Preliminary_AnchoringAPI`; un prim hijo referencia la capa original y recibe solo una traslación de montaje.
6. No se editan posiciones, normales, UV, materiales, texturas ni dimensiones del GLB.

Fragmento contractual:

```usda
def Xform "InstallationAnchor" (
    prepend apiSchemas = ["Preliminary_AnchoringAPI"]
)
{
    uniform token preliminary:anchoring:type = "plane"
    uniform token preliminary:planeAnchoring:alignment = "vertical"
}
```

## Límites honestos

Este enfoque solicita una superficie vertical y fija la escala real. Quick Look sigue controlando el reconocimiento y la colocación. La web no puede prometer selección semántica de ventana, rechazo de techo, colisión con el recinto ni oclusión por malla de escena. Esas capacidades pertenecen a una ruta nativa con ARKit/RealityKit.

WebXR no se adopta como plan B para iPhone: WebKit anunció WebXR inmersivo para Safari en visionOS, no una ruta productiva equivalente para Safari en iPhone ([WebKit en Safari 18](https://webkit.org/blog/15443/news-from-wwdc24-webkit-in-safari-18-beta/)).
