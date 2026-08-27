# Matriz física de ubicación — iPhone

Estado: `IPHONE_PHYSICAL_TEST = PENDING`.

No se declara ganador antes de ejecutar esta matriz en Safari/Quick Look sobre un iPhone compatible. Cada celda requiere cinco aperturas independientes del AR.

## Configuraciones canónicas

- Sheer Elegance: White, 1,00 × 2,20 m, Binovo, Abierta.
- Panel Japonés: White Grey, 2,50 × 2,20 m, Cerrado.
- Onda Serena: Velo / Coral White, 1,00 × 2,20 m, Cerrada.

## Matriz A/B

| Producto | Método | Pared libre 5× | Centro de ventana 5× | Cerca del techo 5× |
|---|---|---|---|---|
| Sheer | Quick Look actual | Pendiente | Pendiente | Pendiente |
| Sheer | USDZ anclado vertical | Pendiente | Pendiente | Pendiente |
| Panel | Quick Look actual | Pendiente | Pendiente | Pendiente |
| Panel | USDZ anclado vertical | Pendiente | Pendiente | Pendiente |
| Onda | Quick Look actual | Pendiente | Pendiente | Pendiente |
| Onda | USDZ anclado vertical | Pendiente | Pendiente | Pendiente |

## Registrar en cada apertura

1. Reconoce un plano vertical.
2. Origen coincide con el centro superior solicitado.
3. Producto queda vertical y paralelo a la pared.
4. Escala 1:1 permanece fija.
5. Producto no aparece detrás de la pared.
6. Producto no inicia apoyado en piso/mesa.
7. Reapertura es consistente con las anteriores.
8. Tiempo hasta una colocación utilizable.

Además, registrar por separado cualquier clipping con el techo. Un anclaje correcto no implica que Quick Look resuelva colisiones o límites del recinto.

## Criterio de éxito web

Una combinación producto/escenario solo pasa con 5/5 aperturas correctas en verticalidad, origen, escala y lado visible del muro. La decisión A/B debe incluir consistencia y tiempo, no una sola captura favorable.
