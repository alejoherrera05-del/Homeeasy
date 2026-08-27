# HomeEasy AR Marker Placement POC - QA física

Estado: `IPHONE_PHYSICAL_MARKER_TEST = PENDING`.

No se declara éxito desde escritorio. Esta matriz debe ejecutarse en Safari sobre un iPhone real, con la tarjeta A4 impresa al 100 % y verificando con regla que el cuadrado negro mida 18 x 18 cm.

## Configuración congelada

- Motor: AR.js 3.4.8, marker tracking por patrón.
- Marcador: Tarjeta AR HomeEasy, 0,18 x 0,18 m.
- Producto: Onda Serena, Velo / Coral, White, 1,00 x 2,20 m, Cerrada.
- Escala del modelo: 1:1, sin auto scaling ni pinch scaling.
- Smoothing inicial: `smooth=true`, `smoothCount=10`, `smoothTolerance=0.01`, `smoothThreshold=5`.
- Orientación prioritaria: iPhone portrait.

## Registro por apertura

| # | Escenario | Distancia | Detección (s) | Escala/error % | Orientación | Jitter | Pérdida/recuperación | Alineación (cm) | Observaciones |
|---:|---|---:|---:|---:|---|---|---|---:|---|
| 1 | | | | | | | | | |
| 2 | | | | | | | | | |
| 3 | | | | | | | | | |
| 4 | | | | | | | | | |
| 5 | | | | | | | | | |
| 6 | | | | | | | | | |
| 7 | | | | | | | | | |
| 8 | | | | | | | | | |
| 9 | | | | | | | | | |
| 10 | | | | | | | | | |

## Escenarios obligatorios

### A. Pared blanca

Diez aperturas con la tarjeta plana y completamente visible. Medir tiempo hasta detección, estabilidad, escala y error de alineación.

### B. Vidrio de ventana

Diez aperturas. Registrar reflejos, contraluz y cualquier degradación frente a pared blanca.

### C. Cerca del techo

Diez aperturas. Confirmar que el producto permanece ligado a la tarjeta y registrar cualquier intersección visual con el techo. El POC no implementa colisiones del entorno.

### D. Reubicar de ventana A a ventana B

Diez traslados físicos de la tarjeta. Al retirarla debe aparecer `MARKER_LOST` y el producto debe ocultarse. Al colocarla en B debe recuperarse sin reiniciar cámara.

## Distancia

Probar la tarjeta de 18 cm a 0,5 m, 1 m, 2 m y 3 m. Registrar la distancia máxima útil; no extrapolar resultados. Solo si falla a 3 m se autoriza una segunda prueba futura con tarjeta de 20 cm, sin cambiar el sistema.

## Criterios del piloto

- Detección normal: <= 3 s.
- Reubicación A a B: 10/10.
- Recuperación tras perder marcador: 10/10.
- Colocación accidental en techo: 0/10.
- Modelo detrás del plano de pared: 0/10.
- Error ideal de escala: <= 3 %.

## Calibración

Comparar 100 cm del ancho virtual con cinta métrica real. Usar los controles de 1 cm/5 cm únicamente para corregir X/Y dentro del plano del marcador. `Acercar a pared` y `Alejar 1 cm` son controles QA de profundidad; no cambian la escala.

## Resultado

`IPHONE_PHYSICAL_MARKER_TEST = PENDING`

No completar ni firmar esta sección hasta ejecutar el ensayo físico.
