# Hommy 10C.2 · Latencia de seguimiento

Objetivo: evitar que el primer seguimiento por silencio dependa de una llamada larga al modelo cuando WhatsApp ya aporta evidencia suficiente y segura.

Diseño:
- Si existe entrega confirmada de la cotización por WhatsApp, no hay respuesta posterior, no existen intentos previos y ya transcurrió la ventana mínima, Hommy construye el primer borrador con una regla comercial determinística basada en el playbook.
- Si aún es pronto, devuelve WAIT y programa la próxima revisión sugerida.
- Casos con respuestas, objeciones, cambios, fechas prometidas o ambigüedad siguen pasando por el modelo.
- La etapa continúa REVIEW-only: no envía nada y no escribe en HomeEasy.
- La llamada OpenAI específica de follow-up queda con timeout y retries propios para no heredar una política demasiado larga del chat general.

Motivación: el frontend tiene un presupuesto de espera finito; el primer silencio es un caso de alta frecuencia, baja ambigüedad y cobertura explícita en el Sales Playbook.
