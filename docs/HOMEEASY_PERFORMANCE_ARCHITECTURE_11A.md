# HomeEasy Performance Architecture 11A

Estado: DISEÑO APROBADO PARA SOCIALIZACIÓN · sin cambios runtime en esta etapa
Fecha: 2026-09-04

## 1. Objetivo

HomeEasy no debe perseguir únicamente un arranque visualmente corto. La meta es aprovechar deliberadamente la pantalla inicial de Hommy como una ventana de preparación para que, al terminar, la navegación posterior se sienta inmediata, estable y coherente incluso en móvil.

El objetivo de 11A es diseñar un sistema de rendimiento completo sin cambiar reglas comerciales, financieras, RBAC, auditoría, generación documental, Seguimiento/Hommy ni las fuentes de verdad de HomeEasy.

Principio rector:

> Esperar unos segundos útiles al inicio es preferible a repetir pequeñas esperas en cada pantalla.

## 2. Contrato visual congelado del splash de Hommy

La animación actual, su identidad, sus mensajes y su secuencia visual se consideran parte del producto y NO se modifican durante 11A.

Mensajes existentes que deben conservarse literalmente:

1. `Hommy está despertando...`
2. `Limpiando sus ojitos...`
3. `Preparándose un café virtual...`
4. `Ajustando su gorra...`

No se reemplazarán por mensajes técnicos, porcentajes falsos ni una barra de progreso que pretenda representar trabajos que no estén ocurriendo.

La pantalla se reutilizará como cubierta visual mientras el Boot Manager ejecuta trabajo real.

### Política de tiempo propuesta

- Se debe permitir que la secuencia visual completa de Hommy alcance su último estado.
- El splash no se cerrará antes de que P0 esté completo.
- P1 tendrá una ventana acotada dentro del splash para calentar navegación.
- Si P1 no termina dentro del presupuesto máximo, HomeEasy abre con seguridad y P1 continúa en segundo plano.
- Ningún fallo de precarga secundaria puede bloquear indefinidamente el acceso a la app.

La duración final exacta se medirá con telemetría antes de fijarla. El objetivo inicial de diseño es aprovechar aproximadamente la ventana visual actual completa, no imponer un temporizador arbitrario adicional.

## 3. Arquitectura objetivo

```text
Splash Hommy
   │
   ├── P0 · Seguridad y shell
   │     ├── Firebase / identidad
   │     ├── sesión HomeEasy
   │     ├── RBAC / permisos
   │     ├── configuración mínima
   │     └── versión de runtime
   │
   ├── P1 · Warm set de alta probabilidad
   │     ├── clientes ligeros
   │     ├── índice comercial OP/COT
   │     ├── agenda cercana
   │     ├── resumen del inicio
   │     └── estados ligeros de seguimiento
   │
   ├── P2 · Precalentamiento no bloqueante
   │     ├── Hommy backend health/warm
   │     ├── HTML/JS de módulos probables
   │     ├── motores PDF en idle
   │     └── assets secundarios
   │
   └── HomeEasy visible
          │
          └── Runtime Cache + revalidación silenciosa
```

## 4. Prioridades del Boot Manager

### P0 · Obligatorio antes de abrir

Solo contiene información necesaria para asegurar que el usuario puede entrar y qué puede hacer.

- validación de identidad;
- sesión general HomeEasy;
- rol y permisos;
- configuración mínima del shell;
- versión del runtime/cache;
- información mínima del usuario autenticado.

P0 jamás se satisface con una caché no validada de una sesión anterior.

### P1 · Warm set durante el splash

Información que cuesta tiempo después y tiene alta probabilidad de reutilizarse en múltiples pantallas.

#### Clientes Lite
Campos mínimos para búsqueda/autocompletado y navegación:

- cédula/id interno;
- nombre;
- teléfono cuando el módulo lo necesite;
- email cuando el módulo lo necesite;
- dirección cuando el formulario realmente la requiera;
- versión del dataset.

No incluir historial del cliente.

#### Índice OP Lite

- número OP;
- cédula cliente;
- nombre cliente;
- fecha;
- estado;
- total no sensible para listado;
- referencia de fila/versión cuando sea segura.

El saldo financiero NO se considera confiable desde esta caché. Cuando Abonos necesite un saldo, se relee la celda/endpoint autoritativo.

#### Índice COT Lite

- número COT;
- cliente;
- fecha;
- estado;
- total;
- datos mínimos que permitan navegación, conversión y radar.

No incluir el historial completo de WhatsApp.

#### Agenda cercana

- hoy;
- próximos días configurables;
- pendientes/vencidos relevantes.

No descargar el histórico completo de Agenda durante el boot.

#### Seguimiento Lite

- número COT;
- estado de seguimiento;
- intención;
- temperatura;
- última actividad;
- si existe información nueva;
- conteo de intentos.

No ejecutar análisis de IA masivo durante el splash.

### P2 · No bloqueante

- warm-up de Hommy `/api/health`;
- prefetch del HTML de módulos de alta probabilidad;
- precalentamiento de librerías PDF;
- recursos visuales secundarios;
- sincronizaciones no urgentes;
- presencia/telemetría.

P2 nunca compite con una acción explícita del usuario.

## 5. HomeEasy Runtime Cache

Se propone crear `homeeasy-runtime.js` como coordinador compartido y pequeño. No será una SPA y no reemplazará los HTML actuales.

### Nivel A · RAM

Cada página mantiene Maps/objetos ya normalizados durante su vida útil.

Uso:

- búsquedas;
- índices;
- deduplicación de solicitudes;
- datos ya hidratados desde IndexedDB.

### Nivel B · IndexedDB

Persistencia estructurada entre navegaciones HTML dentro del mismo navegador.

Bundles previstos:

- `clients-lite`;
- `orders-lite`;
- `quotes-lite`;
- `agenda-near`;
- `followup-lite`;
- `config-lite`.

Cada bundle guarda:

```json
{
  "schema": 1,
  "dataset": "clients-lite",
  "version": "...",
  "fetchedAt": "...",
  "userScope": "...",
  "data": []
}
```

Nunca se mezclan cachés entre usuarios.

### Nivel C · Servidor

Google Sheets / Apps Script continúan siendo fuente de verdad.

Regla de oro:

> La caché puede acelerar lectura y navegación. Nunca puede autorizar, cobrar, decidir un saldo financiero, modificar un documento ni sustituir una validación de seguridad.

## 6. Estrategia stale-while-revalidate controlada

Para información no crítica:

1. mostrar inmediatamente la última versión válida de caché;
2. consultar versión/frescura en segundo plano;
3. si no cambió, no descargar de nuevo;
4. si cambió, reemplazar el bundle y actualizar la vista sin bloquear.

Para información crítica:

- sesión/permiso: siempre validación autoritativa;
- saldo: siempre lectura autoritativa actual;
- numeración de documentos: siempre servidor + lock existente;
- anulaciones: siempre flujo seguro existente;
- envío WhatsApp: revalidación existente antes de enviar;
- escritura de cotizaciones/OP/abonos: respuesta autoritativa del servidor.

## 7. Versionado de datasets en el Cerebro

En vez de pedir hojas completas repetidamente, el Cerebro tendrá versiones de datasets.

Ejemplo conceptual:

```text
clientes.version      = 184
ordenes.version       = 93
cotizaciones.version  = 41
agenda.version        = 208
config.version        = 12
seguimiento.version   = 66
```

Las escrituras que afecten un dataset incrementan o invalidan su versión.

El navegador envía sus versiones actuales y el endpoint de sincronización responde solo los bundles modificados.

Ejemplo:

```json
{
  "known": {
    "clients": 184,
    "orders": 91,
    "agenda": 208
  }
}
```

Respuesta:

```json
{
  "clients": {"notModified": true, "version": 184},
  "orders": {"notModified": false, "version": 93, "data": []},
  "agenda": {"notModified": true, "version": 208}
}
```

Esto evita volver a transportar datasets que ya están actualizados.

## 8. Índices server-side

El Cerebro utiliza actualmente en varias rutas el patrón `getDataRange().getValues()` + recorrido completo. 11A propone índices auxiliares en `CacheService` para resolver rápidamente entidad → fila.

Índices iniciales:

```text
cliente:{cedula}  -> row
cot:{numero}      -> row
op:{numero}       -> row
```

Cuando una escritura cambia estructura o inserta una entidad, el índice relacionado se actualiza o invalida.

### Regla financiera

Un índice puede decir dónde está una OP. No puede decir cuánto debe.

Para `VERIFICAR_SALDO`:

```text
OP -> índice -> número de fila -> lectura directa de la celda de saldo actual
```

De esta forma se acelera el acceso sin cachear la verdad financiera.

## 9. Request Coordinator

El Runtime mantendrá un registro de solicitudes en curso.

Si dos componentes piden la misma información al mismo tiempo:

```text
GET clients-lite
GET clients-lite
```

solo se realiza una petición real y ambos consumidores esperan la misma Promise.

### Cola de prioridad

- `P0`: autenticación/seguridad;
- `P1`: pantalla que el usuario está abriendo;
- `P2`: precarga probable;
- `P3`: telemetría, presencia y mantenimiento.

Límite inicial de diseño: 3 solicitudes remotas simultáneas de precarga. Las acciones explícitas del usuario tienen prioridad y pueden desplazar P2/P3.

## 10. Navegación predictiva

No se descargará toda la aplicación.

El Runtime utilizará un manifest de probabilidad.

Ejemplo:

```text
Inicio -> Clientes / Cotización / Seguimiento
Cotización -> Pedido / Seguimiento
Pedido -> Abono / Clientes
Abono -> Ventas / Clientes
Seguimiento -> Cotización / WhatsApp context
Reportes -> Ventas
```

Cuando el navegador quede ocioso:

- `prefetch` del HTML/JS del próximo módulo probable;
- hidratación del bundle necesario si no está fresco;
- nunca ejecutar una acción de escritura.

## 11. Qué NO debe hacerse

- no convertir HomeEasy a SPA para lograr esta mejora;
- no introducir Service Worker en la primera etapa 11A;
- no cachear respuestas financieras autoritativas como verdad;
- no precargar historiales completos de WhatsApp;
- no ejecutar IA sobre todas las cotizaciones durante el splash;
- no descargar Auditoría completa;
- no descargar Agenda histórica completa;
- no generar PDFs al iniciar;
- no alterar la animación ni los mensajes de Hommy;
- no sacrificar nitidez/calidad de PDFs;
- no relajar RBAC, sesiones, locks, idempotencia o validaciones.

## 12. Instrumentación antes de optimizar más

Se crearán métricas internas sin datos personales:

- `boot.p0_ms`;
- `boot.p1_ms`;
- `boot.total_ms`;
- `runtime.cache_hit`;
- `runtime.cache_miss`;
- `runtime.request_deduped`;
- `runtime.background_refresh_ms`;
- `nav.click_to_shell_ms`;
- `nav.click_to_data_ms`;
- `apps_script.request_ms` por tipo de ruta;
- `hommy.plan_ms`;
- `whatsapp.context_ms`.

No se guardarán conversaciones, clientes ni contenido financiero dentro de telemetría de rendimiento.

## 13. Objetivos medibles iniciales

Los números finales se ajustarán tras obtener baseline real, pero 11A propone:

| Experiencia | Objetivo inicial |
|---|---:|
| Splash | usar la secuencia completa de Hommy para trabajo real |
| Navegación a pantalla con bundle caliente | shell visible < 250 ms |
| Datos cacheados válidos | visibles < 350 ms |
| Revalidación en segundo plano | no bloquear interacción |
| Búsqueda local | respuesta visual < 50 ms después del debounce |
| Solicitudes duplicadas idénticas simultáneas | 0 |
| Precargas concurrentes | máximo 3 |
| Acción explícita del usuario | prioridad sobre precarga |
| Saldo/operación financiera | siempre autoritativa |

## 14. Fases de implementación

### 11A.0 · Baseline e instrumentación

Sin cambios visibles.

- medir tiempos reales actuales;
- registrar performance marks en navegador;
- perfilar Apps Script por ruta;
- construir reporte antes/después.

Gate: ningún cambio comercial.

### 11A.1 · Boot Manager en shadow mode

- mantener splash visual exactamente igual;
- ejecutar P0/P1/P2 detrás;
- escribir caché, pero las páginas todavía no dependen de ella;
- comparar datos cacheados vs respuestas actuales.

Gate: equivalencia 100 % para datasets de lectura.

### 11A.2 · Runtime Cache para Clientes/Cotización/Pedido

- habilitar lectura instantánea desde Runtime;
- revalidación silenciosa;
- búsquedas con índice compartido.

Gate: creación/edición/PDF sin regresiones.

### 11A.3 · OP/Abonos/Agenda

- OP Lite para búsqueda;
- saldo continúa live;
- Agenda cercana en boot y completa solo bajo demanda;
- batch de operaciones recurrentes.

Gate: pruebas financieras y Agenda.

### 11A.4 · Seguimiento

- `followup-lite` en el warm set;
- historial/WhatsApp continúan bajo demanda;
- planes de IA solo cuando corresponda;
- radar inicial inmediato.

Gate: 10B/10D/10E/10F + REVIEW-only.

### 11A.5 · Cerebro indexado y sync delta

- índices `cliente/COT/OP -> row`;
- versiones por dataset;
- endpoint de sincronización incremental;
- CacheService con invalidación en escrituras.

Gate: equivalencia contra lectura tradicional y pruebas 9A/9C/10A.

### 11A.6 · Navegación predictiva

- manifest de afinidad entre módulos;
- prefetch solo en idle;
- pausa automática cuando el usuario actúa, la red es lenta o la pestaña está oculta.

## 15. Estrategia de rollout

Cada fase se implementa en branch separada.

Orden obligatorio:

1. contratos/QA antes del código;
2. shadow mode cuando sea posible;
3. PR con diff limitado;
4. GitHub Actions verde;
5. despliegue;
6. medición antes/después;
7. solo entonces avanzar.

No se harán cambios manuales masivos en producción.

## 16. Criterio de éxito

11A se considera exitosa cuando HomeEasy se comporta de esta manera:

1. Hommy aparece con la misma animación y los mismos mensajes de siempre.
2. Mientras el usuario mira esa pantalla, HomeEasy hace trabajo útil.
3. Al abrir el menú, los módulos más usados ya tienen sus datos base calientes.
4. Cambiar de pantalla no implica repetir las mismas descargas.
5. La información reciente aparece de inmediato y se actualiza detrás.
6. Las operaciones delicadas siguen consultando la fuente autoritativa.
7. El sistema puede crecer en registros sin que cada búsqueda obligue a recorrer hojas completas.
8. Las regresiones de rendimiento quedan protegidas por CI.

---

### Decisiones congeladas antes de escribir runtime 11A

- Splash Hommy: conservar animación, textos e identidad.
- Seguridad: no se relaja.
- Arquitectura HTML multi-página: se conserva.
- Sheets/Apps Script: se conservan como fuente de verdad.
- Modo Seguimiento: REVIEW permanece.
- Finanzas: nunca depender de caché para saldo/confirmación.
- Primer paso de implementación: instrumentación + Boot Manager en shadow mode, no optimización agresiva.
