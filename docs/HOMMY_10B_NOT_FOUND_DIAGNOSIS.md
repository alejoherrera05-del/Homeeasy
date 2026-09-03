# Diagnóstico temporal

El backend 10B distinguía cualquier `status=not_found` de Apps Script como cotización inexistente. El `doPostOperacion_` legacy también devuelve `status=not_found` sin mensaje cuando una ruta POST no existe en la versión web publicada. Esto puede ocurrir cuando el código 10A está instalado/probado en el editor pero el deployment `/exec` aún apunta a una versión anterior.

Regla de hardening: solo tratar como cotización inexistente un `not_found` que venga acompañado del mensaje específico de la ruta 10A. Un `not_found` vacío debe tratarse como ruta/deployment desactualizado.
