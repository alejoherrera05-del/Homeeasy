from utilidades import formato_moneda, normalizar
import re


def buscar_cliente(cerebro, texto):
    tn = normalizar(texto)
    if len(tn) < 3:
        return []
    res = []
    for ced, data in cerebro.db_clientes.items():
        nombre_n = normalizar(data["nombre"])
        ced_n = normalizar(ced)
        tel_n = normalizar(data["telefono"])
        if tn in nombre_n or tn in ced_n or tn in tel_n:
            res.append((ced, data))
    return res


def buscar_op_por_numero(cerebro, numero):
    num = str(numero).strip()
    for op in cerebro.db_ordenes:
        if str(op["numero"]).strip() == num:
            return op
    return None


def get_agenda_hoy(cerebro):
    return [
        t for t in cerebro.db_agenda
        if t["fecha"] == cerebro.fecha_hoy
        and t["estado"] != "COMPLETADO"
    ]


def get_ordenes_con_saldo(cerebro):
    res = []
    for op in cerebro.db_ordenes:
        try:
            s = float(
                str(op["saldo"])
                .replace("$", "")
                .replace(".", "")
                .replace(",", "")
                .strip()
            )
            if s > 0 and op["estado"] != "ANULADA":
                res.append(op)
        except:
            pass
    return res


def numero_op_int(op):
    try:
        return int(str(op["numero"]).strip())
    except:
        return 0


def get_ultima_venta(cerebro):
    validas = []
    for op in cerebro.db_ordenes:
        if op["estado"] == "ANULADA":
            continue
        try:
            n = int(str(op["numero"]).strip())
            if n > 0:
                validas.append(op)
        except:
            pass
    if not validas:
        return None
    validas.sort(key=numero_op_int)
    return validas[-1]


def get_ultimo_abono(cerebro):
    todos = []
    for nop, lista in cerebro.db_abonos.items():
        for ab in lista:
            ab["numero_op"] = nop
            todos.append(ab)
    if not todos:
        return None
    return todos[-1]


def extraer_numero_op(texto):
    patrones = [
        r'op[\s\-\_\#]*(\d+)',
        r'orden[\s\-\_\#]*(\d+)',
        r'pedido[\s\-\_\#]*(\d+)',
    ]
    texto_lower = texto.lower()
    for patron in patrones:
        match = re.search(patron, texto_lower)
        if match:
            return match.group(1)
    return None


def formato_op(op):
    ctx = "ORDEN DE PEDIDO (VENTA):\n"
    ctx += "  OP-" + op["numero"]
    ctx += " | Cliente: " + op["nombre"]
    ctx += " | Fecha: " + op["fecha"] + "\n"
    ctx += "  Productos: " + op["descripcion"] + "\n"
    ctx += "  Total: " + formato_moneda(op["total"])
    ctx += " | Abono: " + formato_moneda(op["abono_inicial"])
    ctx += " | SALDO: " + formato_moneda(op["saldo"])
    ctx += " | Estado: " + op["estado"] + "\n"
    if op["abonos_extra"]:
        ctx += "  Pagos:\n"
        for ab in op["abonos_extra"]:
            ctx += "    - R#" + ab["recibo"]
            ctx += " (" + ab["fecha"] + "): "
            ctx += formato_moneda(ab["valor"])
            ctx += " via " + ab["medio"] + "\n"
    return ctx


def formato_cliente(ced, data):
    ctx = "DATOS DEL CLIENTE:\n"
    ctx += "  Nombre: " + data["nombre"] + "\n"
    ctx += "  Cedula: " + ced + "\n"
    ctx += "  Telefono: " + data["telefono"] + "\n"
    ctx += "  Email: " + data["email"] + "\n"
    ctx += "  Direccion: " + data["direccion"] + "\n"
    if data["cotizaciones"]:
        ctx += "  COTIZACIONES:\n"
        for c in data["cotizaciones"]:
            ctx += "    - COT-" + c["numero"]
            ctx += " | Productos: " + c["descripcion"] 
            ctx += " | Total: " + formato_moneda(c["total"])
            ctx += " | Estado: " + c["estado"]
            ctx += " | Link PDF: " + c.get("url_pdf", "N/A") + "\n"
    if data["ordenes"]:
        ctx += "  VENTAS:\n"
        for o in data["ordenes"]:
            ctx += "    - OP-" + o["numero"]
            ctx += " | Productos: " + o["descripcion"] + "\n"
            ctx += "      Total: " + formato_moneda(o["total"])
            ctx += " | Abono: " + formato_moneda(o["abono_inicial"])
            ctx += " | SALDO: " + formato_moneda(o["saldo"])
            ctx += " | Estado: " + o["estado"]
            ctx += " | Link PDF: " + o.get("url_pdf", "N/A") + "\n"
            if o["abonos_extra"]:
                ctx += "  Pagos:\n"
                for ab in o["abonos_extra"]:
                    ctx += "    - R#" + ab["recibo"]
                    ctx += " (" + ab["fecha"] + "): "
                    ctx += formato_moneda(ab["valor"])
                    ctx += " via " + ab["medio"]
                    ctx += " | Link PDF: " + ab.get("url_pdf", "N/A") + "\n"
    if not data["cotizaciones"] and not data["ordenes"]:
        ctx += "  No tiene cotizaciones ni ventas.\n"
    return ctx

PALABRAS_BASURA = [
    "cual", "cuales", "como", "quien", "quienes",
    "donde", "cuando", "datos", "contacto", "tiene",
    "dame", "dime", "favor", "hola", "venta", "ventas",
    "ultima", "ultimo", "general", "resumen", "cuanto",
    "cuanta", "todas", "todos", "esta", "este", "esos",
    "esas", "para", "pero", "que", "los", "las", "del",
    "una", "uno", "con", "por", "mas", "son", "fue",
    "ser", "hay", "muy", "bien", "mal", "hoy", "ayer",
    "nombre", "numero", "total", "saldo", "estado",
    "plata", "debe", "deben", "deuda", "cobrar",
    "pendiente", "pagar", "dinero", "cartera",
    "agenda", "tarea", "programado", "calendario",
    "abono", "pago", "recibo", "reporte", "estadistica",
]


def extraer_nombres(pregunta):
    limpia = pregunta.replace("?", "").replace("!", "")
    limpia = limpia.replace(",", "").replace(".", "")
    limpia = limpia.replace("¿", "").replace("¡", "")
    nombres = []
    for pal in limpia.split():
        if len(pal) >= 3 and pal.lower() not in PALABRAS_BASURA:
            nombres.append(pal)
    return nombres


def generar_contexto(cerebro, pregunta):
    ctx = "FECHA DE HOY: " + cerebro.fecha_hoy + "\n\n"
    pn = normalizar(pregunta)

    # 1. AGENDA
    pa = ["agenda", "tarea", "hoy", "programado", "calendario"]
    if any(p in pn for p in pa):
        tareas = get_agenda_hoy(cerebro)
        if tareas:
            ctx += "AGENDA DE HOY:\n"
            for t in tareas:
                ctx += "  - " + t["hora"]
                ctx += " | " + t["titulo"]
                ctx += " (" + t["categoria"] + ")"
                ctx += " | Cliente: " + t["cliente"] + "\n"
        else:
            ctx += "AGENDA: No hay tareas hoy.\n"
        ctx += "\n"

    # 2. BUSCAR OP POR NUMERO
    num_op = extraer_numero_op(pregunta)
    if num_op:
        op = buscar_op_por_numero(cerebro, num_op)
        if op:
            ctx += formato_op(op)
            cli = buscar_cliente(cerebro, op["nombre"])
            if cli:
                ctx += "\n" + formato_cliente(cli[0][0], cli[0][1])
            ctx += "\n"
        else:
            ctx += "No encontre la OP-" + num_op + "\n\n"

    # 3. SALDOS Y DEUDAS
    ps = ["saldo", "deuda", "deben", "debe", "cobrar", "cartera", "moroso", "plata", "dinero", "pendiente", "pagar"]
    if any(p in pn for p in ps):
        ops = get_ordenes_con_saldo(cerebro)
        if ops:
            ctx += "OPs CON SALDO PENDIENTE:\n"
            for op in ops:
                ctx += "  - OP-" + op["numero"]
                ctx += " | " + op["nombre"]
                ctx += " | Total: " + formato_moneda(op["total"])
                ctx += " | Saldo: " + formato_moneda(op["saldo"])
                ctx += "\n"
        else:
            ctx += "No hay OPs con saldo pendiente.\n"
        ctx += "\n"

    # 4. ULTIMA VENTA
    pu = ["ultima venta", "ultimo pedido", "ultima orden"]
    if any(p in pn for p in pu):
        uv = get_ultima_venta(cerebro)
        if uv:
            ctx += "ULTIMA " + formato_op(uv)
            ctx += "  NOTA: Esto es una VENTA.\n"
            cli = buscar_cliente(cerebro, uv["nombre"])
            if cli:
                ctx += "\n" + formato_cliente(cli[0][0], cli[0][1])
        ctx += "\n"

    # 5. ULTIMO ABONO
    pab = ["ultimo abono", "ultimo pago", "ultimo recibo"]
    if any(p in pn for p in pab):
        ua = get_ultimo_abono(cerebro)
        if ua:
            ctx += "ULTIMO ABONO:\n"
            ctx += "  - R#" + ua["recibo"]
            ctx += " | OP-" + ua["numero_op"]
            ctx += " | Fecha: " + ua["fecha"]
            ctx += " | Valor: " + formato_moneda(ua["valor"])
            ctx += " | Via: " + ua["medio"] + "\n"
        else:
            ctx += "No hay abonos registrados.\n"
        ctx += "\n"

    # 6. RESUMEN
    pr = ["cuantos", "total", "resumen", "reporte", "estadistica"]
    if any(p in pn for p in pr):
        act = len([o for o in cerebro.db_ordenes if o["estado"] == "ACTIVO"])
        comp = len([o for o in cerebro.db_ordenes if o["estado"] == "COMPLETADO"])
        tv = 0
        tp = 0
        for op in cerebro.db_ordenes:
            if op["estado"] == "ANULADA":
                continue
            try:
                tv += float(str(op["total"]).replace("$", "").replace(".", "").replace(",", "").strip())
                tp += float(str(op["saldo"]).replace("$", "").replace(".", "").replace(",", "").strip())
            except:
                pass
        ctx += "RESUMEN GENERAL:\n"
        ctx += "  - Clientes: " + str(len(cerebro.db_clientes)) + "\n"
        ctx += "  - Cotizaciones: " + str(len(cerebro.db_cotizaciones)) + "\n"
        ctx += "  - Ventas: " + str(len(cerebro.db_ordenes))
        ctx += " (Activas: " + str(act)
        ctx += " | Completadas: " + str(comp) + ")\n"
        ctx += "  - Vendido: " + formato_moneda(tv) + "\n"
        ctx += "  - Pendiente: " + formato_moneda(tp) + "\n"

    # 7. BUSCAR CLIENTE POR NOMBRE (SIEMPRE AL FINAL)
    nombres = extraer_nombres(pregunta)
    for nombre in nombres:
        found = buscar_cliente(cerebro, nombre)
        if found:
            ctx += formato_cliente(found[0][0], found[0][1]) + "\n"
            break

    # SI NO ENCONTRO NADA
    base = "FECHA DE HOY: " + cerebro.fecha_hoy + "\n\n"
    if ctx == base:
        ctx += "No encontre datos especificos.\n"

    return ctx