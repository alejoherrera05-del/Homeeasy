# Pentagrama: reglas de fabricación para Enrollables

Fecha de verificación: 2026-10-02.

## Fuentes

- Portal privado de distribuidores de Persianas Pentagrama, flujo `Nuevo Pedido/Cotización > ENROLLABLE`.
- Tabla enlazada por el propio cotizador: `418_TABLACABEZALESPENTAGRAMANOV2025.xlsx`.
- Hojas vigentes del archivo: `TABLAS` para grupo, ancho de rollo y permiso de atravesar; `TABLA PENTAGRAMA` para las combinaciones de mecanismo y tubo.

El portal advierte que acepta medidas sin validar por sí solo su fabricación. Por eso un precio visible no demuestra que la persiana sea fabricable: la medida también debe caber en la tabla oficial de mecanismos/cabezales.

## Caso obligatorio: Blackout Matte 3, 2,00 × 3,20 m

`TABLAS` clasifica `Blackout Matte 3` en el grupo 5, con rollo nominal de 3,00 m y permiso de atravesar. En la configuración manual Standard, la banda del grupo 5 que llega a 2,60 × 3,20 m usa tubo T50 y mecanismo VTX-20 o Clic M. La medida 2,00 × 3,20 m cabe en esa banda y no necesita motorización, división ni recargo.

La configuración equivalente a HomeEasy es `STANDARD/PLATINA SIN CABEZAL`:

| Campo | Resultado del portal |
| --- | ---: |
| Área | 6,40 m² |
| Precio de lista | $1.056.000,00 |
| Neto distribuidor antes de IVA | $376.960,00 |
| IVA | $71.622,40 |
| Total proveedor con IVA | $448.582,40 |
| Tarifa neta antes de IVA | $58.900,00/m² |
| Tarifa con IVA | $70.091,00/m² |

La tarifa de $70.091,00/m² ya existe en `Costos_Pentagrama` para `enrollable-blackout-matte3`. El defecto estaba en la regla genérica de medidas, no en el precio.

Como control adicional, 2,00 × 2,40 m dio $336.436,80 con IVA, exactamente 4,80 × $70.091,00. No hay escalones ni recargo en estos puntos.

## Paridad de la configuración usada por HomeEasy

Se repitió la cotización en `STANDARD/PLATINA SIN CABEZAL`, con cantidad 1 y sin accesorios. Los totales de HomeEasy se calcularon con las tarifas vigentes de `Costos_Pentagrama`. La diferencia fue $0,00 en los once casos.

| Referencia | Ancho | Alto | Orientación del portal | Total portal con IVA | Total HomeEasy | Diferencia |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| Matte 3 | 2,00 | 2,40 | Normal | $336.436,80 | $336.436,80 | $0,00 |
| Matte 3 | 2,00 | 2,50 | Normal | $350.455,00 | $350.455,00 | $0,00 |
| Matte 3 | 2,00 | 2,60 | Normal | $364.473,20 | $364.473,20 | $0,00 |
| Matte 3 | 2,00 | 2,80 | Normal | $392.509,60 | $392.509,60 | $0,00 |
| Matte 3 | 2,00 | 3,00 | Normal | $420.546,00 | $420.546,00 | $0,00 |
| Matte 3 | 2,00 | 3,20 | Normal | $448.582,40 | $448.582,40 | $0,00 |
| Anirak | 2,00 | 3,00 | Normal | $701.719,20 | $701.719,20 | $0,00 |
| Anirak | 2,50 | 3,00 | Atravesada y añadida | $877.149,00 | $877.149,00 | $0,00 |
| Screen Essential 3005 5% | 2,00 | 3,00 | Normal | $526.289,40 | $526.289,40 | $0,00 |
| Autum | 2,00 | 3,00 | Normal | $985.105,80 | $985.105,80 | $0,00 |
| Screen Estuco | 2,00 | 2,50 | Normal | $356.405,00 | $356.405,00 | $0,00 |

Con cabezal Standard 3″, la misma medida también cabe. El portal mostró VTX/Clic M, tubo T50 según la tabla, componentes en $0, precio de lista $1.363.200, neto $498.560, IVA $94.726,40 y total $593.286,40. Este valor no debe sustituir la tarifa base de HomeEasy porque es otra configuración comercial.

## Matriz Blackout Matte 3 con cabezal Standard 3″

La matriz confirmó precio lineal de lista de $213.000/m² y neto distribuidor de $77.900/m² antes de IVA. Los componentes estándar quedaron en $0.

| Ancho | Alto | Área | Lista | Neto antes de IVA | IVA | Total con IVA |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2,00 | 2,40 | 4,80 | $1.022.400,00 | $373.920,00 | $71.044,80 | $444.964,80 |
| 2,00 | 2,50 | 5,00 | $1.065.000,00 | $389.500,00 | $74.005,00 | $463.505,00 |
| 2,00 | 2,60 | 5,20 | $1.107.600,00 | $405.080,00 | $76.965,20 | $482.045,20 |
| 2,00 | 2,80 | 5,60 | $1.192.800,00 | $436.240,00 | $82.885,60 | $519.125,60 |
| 2,00 | 3,00 | 6,00 | $1.278.000,00 | $467.400,00 | $88.806,00 | $556.206,00 |
| 2,00 | 3,20 | 6,40 | $1.363.200,00 | $498.560,00 | $94.726,40 | $593.286,40 |
| 1,50 | 3,20 | 4,80 | $1.022.400,00 | $373.920,00 | $71.044,80 | $444.964,80 |
| 2,20 | 3,20 | 7,04 | $1.499.520,00 | $548.416,00 | $104.199,04 | $652.615,04 |
| 2,50 | 3,20 | 8,00 | $1.704.000,00 | $623.200,00 | $118.408,00 | $741.608,00 |
| 3,20 | 2,00 | 6,40 | $1.363.200,00 | $498.560,00 | $94.726,40 | $593.286,40 |

El portal calcula todos los puntos, pero la tabla de fabricación sigue siendo obligatoria. Para grupo 5 y Standard, 2,50 × 3,20 sí cabe; 3,20 × 2,00 no cabe en Standard y requiere otra configuración. El portal marca esta última orientación como `Atravesada`.

## Bandas Standard manuales

Cada grupo acepta la primera banda que contenga simultáneamente ancho y alto. Las bandas vienen de la fórmula vigente de `TABLA PENTAGRAMA` para Standard.

| Grupo | Bandas máximas ancho × alto (m) |
| --- | --- |
| 1 | 1,60×2,20 T32; 1,60×3,50 T38; 2,60×3,20 T38; 3,00×3,10 T50; 3,20×2,80 T50 |
| 2 | 1,60×2,20 T32; 1,60×3,20 T38; 2,60×3,20 T38; 3,00×3,10 T50; 3,20×2,60 T50 |
| 3 | 1,60×2,20 T32; 1,60×3,20 T38; 2,20×3,00 T38; 2,60×2,80 T38; 3,00×1,80 T50; 3,20×1,20 T50 |
| 4 / 4A | 1,30×2,20 T32; 1,30×2,80 T38; 1,90×2,70 T38; 2,60×2,50 T38; 2,80×2,50 T50; 3,00×1,80 T50 |
| 5 / 5B | 1,30×2,20 T32; 1,30×3,50 T38; 1,90×3,20 T38; 2,60×3,20 T50; 3,00×2,80 T50 |

## Orientación

- `Normal`: ancho menor o igual al ancho nominal del rollo.
- `Atravesada`: ancho mayor que el rollo, alto menor o igual al rollo y la referencia permite atravesar.
- `Atravesada y Añadida`: ancho y alto mayores que el rollo y la referencia permite atravesar. El portal exige aceptar fabricación sin garantía. El precio sigue la misma tarifa por m²; HomeEasy debe devolver esta autorización en datos estructurados, no ocultarla.
- Si la referencia no permite atravesar y el ancho supera el rollo, la configuración Standard no aplica.

Prueba adicional: Anirak, rollo 2,40 m, 2,50 × 3,00 m. El portal eligió `Atravesada y Añadida`, mostró la advertencia de fabricación sin garantía y calculó $877.149,00 con IVA. Es exactamente 7,50 × $116.953,20, la tarifa que ya existe en Sheets.

## Muestras por grupo y familia

| Referencia | Familia | Grupo | Rollo | Puede atravesar | Medida probada | Resultado del portal |
| --- | --- | --- | ---: | --- | --- | ---: |
| Matte 3 | Blackout | 5 | 3,00 m | Sí | 2,00×3,20 sin cabezal | $448.582,40 con IVA |
| Screen Essential 3005 5% | Screen | 3 | 3,00 m | Sí | 2,00×3,00 sin cabezal | $526.289,40 con IVA |
| Anirak | Traslúcida | 2 | 2,40 m | Sí | 2,50×3,00 sin cabezal | $877.149,00 con IVA; atravesada y añadida |
| Autum | Dim Out | 5B | 2,80 m | Sí | 2,00×3,00 sin cabezal | $985.105,80 con IVA |
| Serenade Bavaro | Serenade | 1 | 2,80 m | Sí | 2,00×3,00 con cabezal 3″ | $953.618,40 con IVA |
| Screen Estuco | Screen | 4A | 3,00 m | No | 2,00×2,50 sin cabezal | $356.405,00 con IVA |

Las reglas se comparten por grupo de espesor, no por familia comercial. El ancho de rollo y el permiso de atravesar siguen siendo específicos de cada referencia.

## Criterio de implementación

- Guardar las bandas por grupo en `Costos_Pentagrama_Config`.
- Guardar en `Notas` de cada referencia respaldada por la tabla: `sizeGroup`, `rollWidthMm`, `canRotate` y el identificador de regla.
- No modificar tarifas.
- Mantener el comportamiento anterior en referencias que no puedan vincularse inequívocamente con la tabla oficial.
- Devolver metadatos de fabricación en cálculos soportados y una alternativa estructurada cuando Standard no aplique.
