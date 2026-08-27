# HomeEasy AR — cierre visual Binovo y separación de telos

Referencia de comparación: `8787ca30fd1b4ee076f5262a00ba4cff1f8d4479`.

## Causa raíz y corrección

- **Sheer Binovo:** `Tapa_Lateral_Izq` y `Tapa_Lateral_Der` compartían el mismo accesor de índices. Los dos saneamientos consecutivos de las interfaces internas truncaban dos veces ese accesor y eliminaban las caras exteriores. Ahora cada tapa recibe un índice filtrado independiente; solo queda abierta la interfaz cuerpo–tapa.
- **Panel Japonés:** cada `PANEL_TELO_N` era un plano de 4 vértices, 2 triángulos y grosor cero. Ahora todos reutilizan una única malla textil cerrada de 0,56 mm, con el mismo material Tretto, sus vías/Z originales, portatelos y pesos inferiores.

## Archivos de producción modificados

- `products/sheer/production/apply-sheer-fabric-pack.js`
- `products/panel/production/panel-japones-builder.js`

No se modificaron `ar-homeeasy-v3.html`, `production/studio-core.js`, Sheer Standard, los masters GLB, fabric packs Tretto, Onda Serena, Marker POC, Index, Login, navegación, autenticación, `ar-placement`, `ar-scale` ni Quick Look.

## Mediciones

| Verificación | Antes | Después |
|---|---:|---:|
| caras exteriores tapa Binovo izquierda | 0 | 2 |
| caras exteriores tapa Binovo derecha | 0 | 2 |
| caras internas duplicadas cuerpo/tapas | 0 | 0 |
| grosor geométrico de telo | 0 m | 0,00056 m |
| geometría de telo | 4 vértices / 2 triángulos | 24 vértices / 12 triángulos |
| traslapes cerrados | 0,08 m | 0,08 m |
| Z de vías, caso 4 vías | −0,027 / −0,009 / 0,009 / 0,027 m | sin cambio |
| hash geométrico Sheer Standard | `925925528b444442c1c0e8327fa1a80e2cffbedd5aa093054da44785d4688b08` | idéntico |

## Evidencia y validación

- `qa/sheer-binovo/BINOVO_ENDCAP_BEFORE_AFTER.jpg`
- `qa/panel-visual-separation/PANEL_TELOS_BEFORE_AFTER.jpg`
- Khronos glTF Validator: **6 GLB, 0 errores, 0 warnings**.
- `model-viewer-4.3.1.min.js` real, no stub: Binovo carga y rota; Panel carga Cerrado/Parcial/Recogido; Panel→Sheer→Panel pasa; consola sin errores.
- El botón AR recibe exactamente el Blob GLB activo de preview, sin `ios-src`; `ar-placement="wall"` y `ar-scale="fixed"` permanecen intactos.
- `PHYSICAL_QUICK_LOOK_IPHONE_TEST = PENDING`.

Resultado: **PASS**.
