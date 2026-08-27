# Auditoría física — Sheer Elegance Standard

## Alcance y resultado

La corrección afecta únicamente la construcción paramétrica del cabezal **Standard** en `products/sheer/production/apply-sheer-fabric-pack.js`. El Standard dejó de ser una deformación de `Cabezal_Binovo_Plano` y ahora se genera como un cuerpo y dos tapas propios. Binovo, los textiles Sheer, los fabric packs, Panel Japonés, Onda Serena, Studio y Quick Look no fueron modificados.

Resultado automático: **PASS**. Los siete GLB runtime auditados obtuvieron **0 errores y 0 warnings** en Khronos glTF Validator.

## Fuentes Pentagrama

Fuente primaria: `581_FichaSheerElegance.pdf`.

- Página 2: identifica Standard como cabezal para persianas pequeñas, indica 7,2 cm de profundidad, espacio mínimo de instalación de 9,5 cm, tapas laterales del mismo color y muestra la silueta compacta redondeada.
- Página 3: tabla de medidas con sección Standard de **7,2 × 7,2 cm**, ancho máximo de 2,60 m o menor según tela, alto máximo entre 1,20 y 2,80 m según configuración, mínimo de 30 cm manual y 45 cm de alto.
- Página 5: confirma el cabezal pequeño Standard y la limitación de altura por el espacio disponible para el enrollamiento.

Pentagrama no publica en ese documento un CAD de la sección, espesor de aluminio, ranuras, pestañas, espesor de tapas, cotas del mecanismo ni offsets internos. Esos datos no se declaran exactos.

## Estado anterior

El runtime partía del mesh Binovo `Cabezal_Binovo_Plano` y de sus tapas, aplicaba `standardProfile()` sobre Y/Z y hacía una segunda normalización a una envolvente de 72 × 72 mm. También:

- eliminaba `Fascia_Frontal` y `Junta_Inferior_Cabezal`;
- ocultaba `Soporte_Pared_Izq` y `Soporte_Pared_Der`;
- eliminaba triángulos coplanares en las uniones cuerpo–tapa para evitar z-fighting;
- recomputaba normales y tangentes sobre la geometría Binovo deformada.

La envolvente exterior resultaba correcta, pero la sección y las tapas seguían heredando la topología Binovo. Para el caso 1,50 × 1,50 m:

- cuerpo: X `[-0,766000; 0,766000]`, Y `[1,560000; 1,632000]`, Z `[0; 0,072000]` m;
- tapas: 8 mm nominales, pero su contorno ocupaba solo Y `[1,562328; 1,630074]` y Z `[0,001387; 0,069327]` m;
- caras exteriores planas detectadas en las tapas: **0 izquierda / 0 derecha**;
- las tapas se leían lateralmente como contornos abiertos, no como superficies físicas cerradas.

Las aberturas del plano interno cuerpo–tapa eran intencionales para evitar solapamiento. La ausencia de una cara exterior opaca en cada tapa no estaba justificada como hueco físico Pentagrama.

## Geometría corregida

El Standard se reconstruye ahora con tres meshes independientes:

- `HomeEasy_Standard_Independent_Body`;
- `HomeEasy_Standard_Left_EndCap`;
- `HomeEasy_Standard_Right_EndCap`.

La sección exterior conserva exactamente la envolvente documentada de 72 × 72 mm. La silueta D compacta se aproxima a la fotografía de Pentagrama mediante un contorno paramétrico propio; `profileShapeExact` continúa en `false`.

Para 1,50 × 1,50 m:

- conjunto de cabezal: X `[-0,774; 0,774]`, Y `[1,560; 1,632]`, Z `[0; 0,072]` m;
- dimensiones: `1,548 × 0,072 × 0,072` m;
- cuerpo: X `[-0,766; 0,766]` m;
- tapas: 8 mm por lado, espesor aproximado no publicado;
- cada tapa tiene 24 triángulos de cierre exterior;
- cuerpo y tapas no contienen caras en sus planos internos de contacto;
- las posiciones del perímetro coinciden en esas uniones, sin separación ni superficies coplanares;
- materiales metálicos: `OPAQUE`, alpha `1`, `doubleSided: false`;
- triángulos invertidos o degenerados en los tres meshes nuevos: `0`.

El perfil se representa como una envolvente exterior opaca. No se afirma que la cavidad interna ni el espesor de pared sean CAD de fábrica.

## Relación con tela, tubo, mecanismos y mando

El frente del producto es **+Z** y la espalda es **Z = 0**.

- Cabezal Standard: Y desde `fabricTop` hasta `fabricTop + 0,072`; Z desde `0` hasta `0,072` m.
- Capa posterior: Z `0,026` m.
- Capa frontal: Z `0,045` m.
- Separación de capas: `0,019` m, sin cambios.
- Tubo: centro Z `0,04104` m. La configuración 1,50 × 1,50 usa tubo de 32 mm; el caso límite 2,60 × 1,20 usa tubo de 38 mm.
- Cadena: Z `0,059` m y conserva mando izquierda/derecha.
- Mecanismos internos, cadena y tubo conservan la parametrización existente; sus cotas finas siguen marcadas como aproximadas porque la ficha no publica CAD interno.
- Los soportes de pared permanecen fuera de la escena comercial.

Las franjas 7/5, Alpha RGBA, PBR, doble recorrido y estados Abierta/Media/Cerrada no se tocaron.

## Integridad de malla

Las únicas superficies abiertas intencionalmente son los dos planos internos de contacto:

1. cuerpo ↔ tapa izquierda;
2. cuerpo ↔ tapa derecha.

No quedan caras coplanares en esas uniones y no son visibles desde el exterior. Las caras externas de ambas tapas sí están cerradas. El test falla si reaparecen caras internas solapadas, si desaparece el cierre exterior, si el metal deja de ser opaco o si existen normales, tangentes o winding inválidos.

## Bounding box y plano de pared AR

Caso canónico auditado: Standard, White, 1,50 × 1,50 m, mando derecha, Abierta.

| Métrica | Antes | Después |
|---|---:|---:|
| min X | -0,774000049 m | -0,774000000 m |
| max X | 0,800699986 m | 0,800699986 m |
| min Y | 0,014000000 m | 0,014000000 m |
| max Y | 1,632000036 m | 1,632000000 m |
| min Z | 0 m | 0 m |
| max Z | 0,071999998 m | 0,072 m |
| profundidad total | 0,071999998 m | 0,072 m |

Antes, `minZ` estaba determinado por `Cabezal_Standard_Plano`. Después, `minZ = 0` está definido conjuntamente por el cuerpo Standard y las dos tapas. Ninguna malla visible se extiende a Z negativo.

Por tanto, si el modo wall de Quick Look coloca el extremo posterior del bounding box contra la pared, el plano físico de pared coincide con **Z = 0**, es decir, con la espalda plana del cabezal y sus tapas. La capa posterior queda 26 mm hacia +Z y la frontal 45 mm hacia +Z. Esto es una lectura geométrica verificable; el anclaje físico final de iPhone continúa pendiente de prueba sobre HTTPS y no se cambió `ar-placement="wall"` ni `ar-scale="fixed"`.

## Regresión y pruebas

Ejecutar:

```powershell
node tests/sheer-standard-physical-audit.mjs
```

Casos generados desde el runtime de producción:

- Standard 1,00 × 1,20 m, mando izquierda, Abierta;
- Standard 1,50 × 1,50 m, mando derecha, Abierta/Media/Cerrada;
- Standard 2,60 × 1,20 m, mando izquierda, Cerrada;
- Binovo 1,80 × 2,20 m, ambos lados y estados representativos.

Comprobaciones PASS:

- GLB válidos; Khronos 0 errores / 0 warnings;
- sección exterior Standard exacta 72 × 72 mm;
- cierres exteriores y uniones cuerpo–tapa;
- metal opaco, normales, tangentes y winding;
- tres medidas, ambos mandos y tres estados;
- hash geométrico Binovo antes/después idéntico: `e36298e2652f98148d7d7592c5e806e8180f9c93a2fe5dcfcccf34ddc3f3cf59`;
- master Sheer intacto: `fee237285d7dbe3e2a00c74da7cb6367c78f244324e798a43c30064bbbe56779`;
- Studio real construyó Standard y conservó el mismo Blob GLB como fuente exacta de preview/Quick Look;
- `ios-src` ausente, `ar-placement="wall"`, `ar-scale="fixed"`;
- Panel, Onda, `production/`, `ar-homeeasy-v3.html`, `index.html` y `login.html`: sin cambios.

Evidencia:

- `qa/sheer-standard/SHEER_STANDARD_BEFORE_AFTER_CONTACT_SHEET.jpg`;
- `qa/sheer-standard/validation/sheer-standard-physical-audit.json`;
- `qa/sheer-standard/validation/khronos-gltf-validator.json`.

## Datos aún aproximados

- contorno exacto de la sección Standard más allá de su envolvente 72 × 72 mm;
- espesor del aluminio y detalles de extrusión interna;
- espesor de tapa de 8 mm;
- sobreancho total de cabezal de 48 mm respecto de la tela;
- ranuras, pestañas y alojamientos del perfil;
- geometría y offsets finos de mecanismos internos;
- cotas finas de cadena y perfil inferior.

No se implementó selección pared/techo ni se ajustaron offsets de instalación.
