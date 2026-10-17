/** Coordinación persistente de un intento de pago entre pestañas del mismo navegador. */
(function(global) {
    'use strict';
    async function obtenerIntentoAbono(datos, numeroRecibo) {
        if (!navigator.locks || !crypto.subtle) throw new Error('Este navegador no puede coordinar pagos entre pestañas. Actualiza el navegador antes de registrar el abono.');
        var digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(datos)));
        var key = 'homeeasy.abono.' + Array.from(new Uint8Array(digest),function(b) { return b.toString(16).padStart(2,'0'); }).join('');
        return navigator.locks.request('homeeasy-abonos',async function() {
            var previo = JSON.parse(localStorage.getItem(key) || 'null');
            if (previo && previo.estado === 'registrado') {
                var nuevo = await Swal.fire({icon:'warning',title:'Ya existe un pago con estos datos',
                    text:'Revisa el recibo ' + previo.numeroRecibo + '. Autoriza una nueva solicitud solo si recibiste otro pago real.',
                    showCancelButton:true,confirmButtonText:'Es otro pago real',cancelButtonText:'Revisar historial',confirmButtonColor:'#a6455a'});
                if (!nuevo.isConfirmed) return null;
                previo = null;
            }
            var intento = previo || {requestId:crypto.randomUUID(),numeroRecibo:numeroRecibo,estado:'incierto'};
            localStorage.setItem(key,JSON.stringify(intento));
            return Object.assign({key:key},intento);
        });
    }
    global.HomeEasyRecibos = Object.freeze({obtenerIntentoAbono:obtenerIntentoAbono});
})(window);
