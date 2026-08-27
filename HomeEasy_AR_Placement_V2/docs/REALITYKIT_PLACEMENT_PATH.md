# Ruta nativa RealityKit — solo si la prueba web no cierra

Este documento es contingencia; no implementa una aplicación nativa.

Si el USDZ anclado mantiene fallas de techo, ventana, reubicación o colisión, la ruta siguiente es ARKit/RealityKit:

1. Ejecutar seguimiento de mundo y detección de planos verticales con `ARPlaneAnchor`.
2. Hacer raycast desde el centro de pantalla y crear un `AnchorEntity` sobre el resultado vertical.
3. Compensar los bounds del producto para que su punto de instalación superior/posterior coincida con el ancla.
4. Permitir arrastrar/reanclar y ofrecer acciones explícitas `Reubicar` y `Bloquear`.
5. Si el dispositivo lo permite, activar reconstrucción de escena y usar `ARMeshClassification` para distinguir pared, ventana y techo.
6. Usar la malla de escena para oclusión y colisión; validar el volumen del producto antes de bloquearlo.

Referencias: [ARPlaneAnchor](https://developer.apple.com/documentation/arkit/arplaneanchor), [AnchorEntity](https://developer.apple.com/documentation/realitykit/anchorentity), [ARMeshClassification](https://developer.apple.com/documentation/arkit/armeshclassification), [sceneReconstruction](https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/scenereconstruction) y [Visualizing and Interacting with a Reconstructed Scene](https://developer.apple.com/documentation/arkit/visualizing-and-interacting-with-a-reconstructed-scene).

La ruta nativa se justifica únicamente por capacidades que Quick Look no expone de forma controlable a esta web. No se debe simular que el anclaje USDZ ya ofrece clasificación semántica, física o malla de entorno.
