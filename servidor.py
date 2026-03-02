from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import traceback
import gspread
import base64
import re
import requests 
from google.oauth2.service_account import Credentials
from openai import OpenAI
from cerebro import CerebroHommy
from buscador import buscar_cliente, formato_cliente, get_ordenes_con_saldo
from config import OPENAI_API_KEY
from datetime import datetime

# =====================================================================
# INICIALIZACIÓN DEL SERVIDOR WEB Y CLAVES
# =====================================================================
app = Flask(__name__)
CORS(app) 

client = OpenAI(api_key=OPENAI_API_KEY)
ELEVENLABS_API_KEY = "sk_df189c9862dd11f5bc6ae7906ce7087891542ff5de41e472"
VOICE_ID = "YTXAg5s9ZonOv6JuXFXV" # <-- ¡VOZ CORREGIDA!

# =====================================================================
# FUNCIONES DE SOPORTE E INFRAESTRUCTURA
# =====================================================================
def parsear_fecha(fecha_str):
    if not fecha_str: 
        return None
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(fecha_str.strip(), formato)
        except ValueError:
            continue
    return None

def limpiar_memoria_segura(historial, limite=35):
    if len(historial) < limite: 
        return historial
    nuevo_historial = [historial[0]] 
    indice_seguro = 1
    for i in range(len(historial) - 15, len(historial)):
        if historial[i]["role"] == "user":
            indice_seguro = i
            break
    nuevo_historial.extend(historial[indice_seguro:])
    return nuevo_historial

# =====================================================================
# CARGA DE LA BASE DE DATOS (CEREBRO Y TARIFAS)
# =====================================================================
print("=" * 70)
print("  Iniciando Servidor Hommy Pro (Versión DIOS ABSOLUTO)...")
print("=" * 70)

db_tarifas = []
try:
    permisos = ["https://www.googleapis.com/auth/spreadsheets"]
    credenciales = Credentials.from_service_account_file("credenciales.json", scopes=permisos)
    cliente_gs = gspread.authorize(credenciales)
    url_archivo = "https://docs.google.com/spreadsheets/d/1hnHAeKhyd9MVCn1bCm8XExl4hdV2ijqdIjCXoJba1iY/edit?usp=sharing"
    archivo = cliente_gs.open_by_url(url_archivo)
    cerebro = CerebroHommy()
    cerebro.cargar_datos(archivo)
    print(" [+] Conexión con Google Sheets principal exitosa.")
    
    try:
        hoja_tarifas = archivo.worksheet("Tarifas")
        db_tarifas = hoja_tarifas.get_all_records()
        print(f" [+] Base de Tarifas cargada: {len(db_tarifas)} configuraciones expertas listas.")
    except Exception as e:
        print(" [!] Advertencia: No se pudo cargar la pestaña 'Tarifas'. Verifique que exista.", e)
except Exception as e:
    print(" [!] Error crítico al cargar la base de datos:", e)

# =====================================================================
# BASE DE CONOCIMIENTO TÉCNICA (ENCICLOPEDIA INTERNA DE PDFs)
# =====================================================================
MANUAL_PENTAGRAMA = {
    "motores": "Pentagrama maneja motores marca Somfy y Motion. Existen para tubos de 35mm, 50mm y 63mm. Se ofrecen en versiones cableadas o a batería recargable (Motion). Los motores alargan la vida útil de la cortina porque evitan los tirones manuales de la cadena. Para motorizar una cortina, el ancho mínimo de fabricación debe ser de 0.65m para que el motor quepa en el tubo.",
    "limpieza_y_mantenimiento": "Regla de oro Pentagrama: Para quitar el polvo, usar plumero o aspiradora con boquilla suave. Para manchas, usar un paño blanco húmedo con jabón muy suave o neutro. JAMÁS usar solventes, blanqueadores, cepillos de cerdas duras ni frotar con fuerza, ya que esto daña el recubrimiento protector UV de la tela.",
    "paneles_japoneses_tecnico": "El Panel Japonés no usa tubo, usa un riel con vías (de 2 a 6 vías). Los telos (lienzos) se superponen. Tipos de recogida disponibles: 1. A la derecha. 2. A la izquierda. 3. A los extremos (mitad a cada lado). 4. Al centro. Los telos se fabrican entre 55cm y 85cm de ancho. Es la mejor solución para ventanas correderas.",
    "onda_serena_tecnico": "Es la cortina hotelera por excelencia. Tipos de recogida: A un lado, a los extremos o al centro. La Onda 2.3 usa reata de 25mm y necesita 11cm de espacio en el techo. La Onda 2.8 usa reata de 50mm, da ondas más profundas y necesita 15cm de espacio en techo. OJO: El riel máximo es de 5.85 metros, si es más grande se debe dividir.",
    "uniones_intermedias": "Cuando el cliente quiere cubrir un ventanal muy ancho que supera el límite de la tela (ej. 4 metros), se debe dividir en dos cortinas. Para que no quede un hueco grande entre las dos, se recomienda vender una 'Unión Intermedia'. Es un soporte especial que une los dos tubos y minimiza la entrada de luz (gap) entre las telas.",
    "garantias": "Las telas Screen y Blackout Pentagrama suelen tener 5 años de garantía contra defectos de fabricación o decoloración. Mecanismos y motores tienen entre 3 y 5 años dependiendo de la marca. La garantía no cubre daños por mala manipulación, mala limpieza o desgaste por exceso de humedad."
}

# =====================================================================
# PERSONALIDAD Y REGLAS DE NEGOCIO (EL MEGA-PROMPT)
# =====================================================================
reglas_hommy = [
    "Eres Hommy, un robotsito asistente, medio torpe y gracioso, pero a la vez un VENDEDOR EXPERTO, analista de datos y MENTOR en HomeEasy Popayán.",
    "Siempre llamas al usuario 'Jefe'. Hablas natural, como un amigo cercano y muy gentil.",
    "Tu misión es cotizar con precisión matemática, pero también FORMAR y ASESORAR a cualquier persona del equipo que hable contigo.",
    "REGLA MAXIMA: JAMAS inventes datos, nombres, telefonos, ventas o precios.",
    f"FECHA ACTUAL DEL SISTEMA: {cerebro.fecha_hoy}.",
    
    "--- 1. REGLAS DE ATENCIÓN Y FORMATO ---",
    "ACTITUD: Usa expresiones muy cálidas ('¡Claro que sí, Jefe!', '¡Uy, te cuento que...', '¡Con mucho gusto!').",
    "FORMATO FINANCIERO OBLIGATORIO: Cuando des una cifra de dinero, DEBES escribirla SIEMPRE en palabras completas (pesos colombianos) seguidas del número entre paréntesis. Ejemplo EXACTO: '¡Claro, Jefe! Llevamos cuatro millones ochocientos mil pesos ($4.800.000)'.",
    "PRIVACIDAD: De los clientes, muestra SOLO: Nombre, Cédula, Teléfono, Email y Dirección.",
    "DOCUMENTOS: Siempre entrega los enlaces PDF usando formato Markdown exacto: [Ver Documento](URL).",
    "ANÁLISIS E INSIGHTS: Si el Jefe te pide un reporte o análisis de ventas, NO le des solo números fríos. Analiza la info y dale 'Insights' (cuál fue la mejor venta, comparaciones, qué días se vende más, etc).",
    
    "--- 2. CONSEJOS BÁSICOS DE DISEÑO ---",
    "ESTÁNDAR (SIN CABEZAL): Es la opción más económica. Advierte al asesor que el tubo de aluminio y el rollo de tela quedan a la vista.",
    "CABEZALES DE LUJO: Explica que sirven para ocultar el tubo. COVERLIGHT es plano/minimalista; CENEFA DE ALUMINIO es curva; BINOVO/PENTA13 son exclusivos para Sheer Elegance.",
    "REGLA DE HABITACIONES (BLACKOUT): ACONSEJA AL ASESOR: 'Recuérdale al cliente que por los bordes laterales siempre entrará un halo de luz. Para evitar que la luz entre por arriba, véndele la cortina con un cabezal'.",
    "PLAN RENUEVA: Si el cliente ya tiene las persianas Pentagrama instaladas y solo quiere cambiar la decoración, ofrécele el plan 'Renueva' (usa solo_tela_renueva=True) donde solo cobramos la tela.",
    "MÁS INFO TÉCNICA: Si el asesor te hace preguntas profundas sobre motores, limpieza, recogida o garantías, usa la herramienta 'consultar_manual_pentagrama'.",

    "--- 3. MOTOR INTELIGENTE DE COTIZACIONES ---",
    "HERRAMIENTA OBLIGATORIA: Usa SIEMPRE 'cotizar_producto'. Al Total con IVA que te arroje la herramienta, DEBES sumarle SIEMPRE $50.000 fijos de transporte logístico antes de darle la cifra final al Jefe.",
    "BÚSQUEDA PROACTIVA: Si te dicen 'un cliente quiere algo económico para su habitación', tú razonas: Habitación = Blackout. Económico = Buscar Blackout económico. Usas 'consultar_catalogo' y le das las 3 mejores opciones."
]
prompt_base = " ".join(reglas_hommy)

historial_global = [{"role": "system", "content": prompt_base}]

# =====================================================================
# ARSENAL DE HERRAMIENTAS (¡EL MÁS COMPLETO!)
# =====================================================================
herramientas_hommy = [
    {
        "type": "function",
        "function": {
            "name": "buscar_informacion_cliente",
            "description": "Busca toda la información de un cliente por su nombre o cédula.",
            "parameters": {"type": "object", "properties": {"criterio": {"type": "string"}}, "required": ["criterio"]}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_saldos_pendientes",
            "description": "Obtiene la lista de clientes que deben dinero.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_agenda",
            "description": "Revisa las tareas, citas y visitas para una fecha específica.",
            "parameters": {"type": "object", "properties": {"fecha": {"type": "string", "description": "Formato exacto YYYY-MM-DD"}}, "required": ["fecha"]}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "obtener_resumen_general",
            "description": "Muestra las estadísticas generales del negocio (cantidad total de clientes, cotizaciones y OPs en el sistema).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "listar_cotizaciones",
            "description": "Muestra una lista general de todas las cotizaciones del sistema.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "obtener_ultimas_ventas",
            "description": "Busca y devuelve las OPs (ventas) más recientes.",
            "parameters": {"type": "object", "properties": {"cantidad": {"type": "integer", "description": "Por defecto 1"}}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generar_reporte_ventas",
            "description": "Calcula el total de ventas en un rango de tiempo. Usar para hacer análisis y dar insights.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fecha_inicio": {"type": "string", "description": "Formato YYYY-MM-DD"},
                    "fecha_fin": {"type": "string", "description": "Formato YYYY-MM-DD"}
                },
                "required": ["fecha_inicio", "fecha_fin"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_historial_pagos_op",
            "description": "Muestra el historial detallado de abonos y saldo de una OP.",
            "parameters": {"type": "object", "properties": {"numero_op": {"type": "string"}}, "required": ["numero_op"]}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_manual_pentagrama",
            "description": "Lee el manual PDF oficial de Pentagrama para responder dudas profundas sobre técnica, limpieza, motores y garantías.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tema": {
                        "type": "string", 
                        "enum": ["motores", "limpieza_y_mantenimiento", "paneles_japoneses_tecnico", "onda_serena_tecnico", "uniones_intermedias", "garantias"],
                        "description": "El tema exacto que deseas consultar en el manual."
                    }
                },
                "required": ["tema"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cotizar_producto",
            "description": "Calcula el costo exacto de una cortina validando límites técnicos de Pentagrama, cabezales y plan Renueva.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sistema": {"type": "string", "description": "Ej: Enrollable, Panel Japonés, Sheer Elegance, Onda Serena"},
                    "tela": {"type": "string", "description": "Ej: Screen Vision 350, Castle Blackout, Serenade Clark"},
                    "ancho": {"type": "number", "description": "Ancho de la cortina."},
                    "alto": {"type": "number", "description": "Alto de la cortina."},
                    "cantidad": {"type": "integer", "description": "Cantidad de persianas a cotizar con esta misma medida."},
                    "incluir_lujo": {"type": "boolean", "description": "True si el usuario pide Coverlight, Cabezal, Cenefa, Binovo o Perfil de Lujo."},
                    "solo_tela_renueva": {"type": "boolean", "description": "True si el usuario pide plan Renueva o 'solo cambiar la tela'."}
                },
                "required": ["sistema", "tela", "ancho", "alto", "cantidad"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_catalogo",
            "description": "Busca telas en el catálogo basándose en las necesidades del cliente, obteniendo argumentos de venta.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sistema": {"type": "string", "description": "Opcional. Ej: Enrollable, Panel, Sheer"},
                    "etiqueta": {"type": "string", "description": "Opcional. Ej: Económica, Media, Premium, Ultra-Premium"},
                    "privacidad": {"type": "string", "description": "Opcional. Ej: Blackout, Screen, Trasluz, DimOut, Cebra"}
                }
            }
        }
    }
]

# =====================================================================
# RUTA 1: EL CHAT DE TEXTO (CEREBRO OPENAI)
# =====================================================================
@app.route('/api/chat', methods=['POST'])
def chat_endpoint():
    global historial_global
    
    datos = request.json
    pregunta = datos.get("pregunta", "")

    if not pregunta: 
        return jsonify({"respuesta": "No recibí ningún texto, Jefe."})
    
    print(f"\n[Usuario] Jefe dice: {pregunta}")
    historial_global.append({"role": "user", "content": pregunta})

    try:
        respuesta = client.chat.completions.create(
            model="gpt-4o-mini", 
            messages=historial_global,
            tools=herramientas_hommy, 
            tool_choice="auto", 
            temperature=0.3 
        )
        
        mensaje_ia = respuesta.choices[0].message
        historial_global.append(mensaje_ia)

        if mensaje_ia.tool_calls:
            print(" [Hommy] Analizando datos con la Base de Datos...")
            
            for tool_call in mensaje_ia.tool_calls:
                nombre_funcion = tool_call.function.name
                argumentos = json.loads(tool_call.function.arguments)
                resultado_busqueda = ""

                # ==========================================================
                # BLOQUE ADMINISTRATIVO (AGENDA, PAGOS, CLIENTES)
                # ==========================================================
                if nombre_funcion == "buscar_informacion_cliente":
                    encontrados = buscar_cliente(cerebro, argumentos.get("criterio"))
                    if encontrados:
                        resultado_busqueda = formato_cliente(encontrados[0][0], encontrados[0][1])
                    else:
                        resultado_busqueda = "No se encontró ningún registro para ese cliente."

                elif nombre_funcion == "consultar_saldos_pendientes":
                    ops = get_ordenes_con_saldo(cerebro)
                    if ops:
                        resultado_busqueda = "OPs con saldo pendiente:\n" + "\n".join([f"OP-{op['numero']} | {op['nombre']} | Saldo: {op['saldo']}" for op in ops])
                    else:
                        resultado_busqueda = "Excelente noticia, Jefe. Todos los clientes están al día, cero deudas."

                elif nombre_funcion == "consultar_agenda":
                    fecha_consulta = argumentos.get("fecha")
                    tareas = [t for t in cerebro.db_agenda if t["fecha"] == fecha_consulta]
                    if tareas:
                        resultado_busqueda = f"Agenda {fecha_consulta}:\n" + "\n".join([f"{t['hora']} - {t['titulo']} ({t['cliente']}) [Estado: {t['estado']}]" for t in tareas])
                    else:
                        resultado_busqueda = "No hay eventos programados para esa fecha."

                elif nombre_funcion == "obtener_resumen_general":
                    resultado_busqueda = f"Hay {len(cerebro.db_clientes)} clientes, {len(cerebro.db_cotizaciones)} cotizaciones y {len(cerebro.db_ordenes)} OPs en el sistema."

                elif nombre_funcion == "listar_cotizaciones":
                    if cerebro.db_cotizaciones:
                        resultado_busqueda = "Cotizaciones activas:\n"
                        for c in cerebro.db_cotizaciones:
                            resultado_busqueda += f"- Fecha: {c.get('fecha', 'N/A')} | COT-{c['numero']} | Cliente: {c['nombre']} | Total: {c['total']} | Link PDF: {c.get('url_pdf', 'N/A')}\n"
                    else:
                        resultado_busqueda = "No hay cotizaciones registradas actualmente."

                elif nombre_funcion == "obtener_ultimas_ventas":
                    cant = argumentos.get("cantidad", 1)
                    if cerebro.db_ordenes:
                        ops_recientes = cerebro.db_ordenes[-cant:]
                        resultado_busqueda = f"Últimas {cant} ventas:\n"
                        for uv in reversed(ops_recientes):
                            resultado_busqueda += f"- OP-{uv['numero']} | Cliente: {uv['nombre']} | Total: {uv['total']} | Abono Inicial: {uv.get('abono_inicial', '0')} | Saldo: {uv['saldo']} | Fecha: {uv['fecha']} | Estado: {uv['estado']} | Link PDF: {uv.get('url_pdf', 'N/A')}\n"
                    else:
                        resultado_busqueda = "El sistema aún no tiene órdenes de pedido registradas."

                elif nombre_funcion == "generar_reporte_ventas":
                    f_ini_str = str(argumentos.get("fecha_inicio", "")).strip()
                    f_fin_str = str(argumentos.get("fecha_fin", "")).strip()
                    
                    if len(f_ini_str) == 7: f_ini_str += "-01"
                    if len(f_fin_str) == 7: f_fin_str += "-28"
                    
                    f_ini = parsear_fecha(f_ini_str)
                    f_fin = parsear_fecha(f_fin_str)
                    
                    if not f_ini or not f_fin:
                        resultado_busqueda = "Hubo un error de formato al procesar el rango de fechas."
                    else:
                        ventas_periodo = []
                        total_vendido = 0
                        
                        for op in cerebro.db_ordenes:
                            if op["estado"] == "ANULADA": 
                                continue
                            
                            f_op = parsear_fecha(op["fecha"])
                            if f_op and f_ini <= f_op <= f_fin:
                                ventas_periodo.append(op)
                                try:
                                    valor_limpio = str(op["total"]).replace("$", "").replace(".", "").replace(",", "").replace(" ", "").strip()
                                    total_vendido += float(valor_limpio)
                                except Exception: 
                                    pass 
                        
                        if ventas_periodo:
                            resultado_busqueda = f"Reporte del {f_ini_str} al {f_fin_str}:\nTOTAL RECAUDADO: ${total_vendido:,.0f}\nVOLUMEN: {len(ventas_periodo)} OPs\n\nDetalle:\n"
                            for op in ventas_periodo:
                                resultado_busqueda += f"- Fecha: {op['fecha']} | OP-{op['numero']} | Cliente: {op['nombre']} | Total: {op['total']}\n"
                        else:
                            resultado_busqueda = f"No se encontraron ventas para el rango del {f_ini_str} al {f_fin_str}."

                elif nombre_funcion == "consultar_historial_pagos_op":
                    num_op = str(argumentos.get("numero_op")).replace("OP-", "").strip()
                    op_encontrada = next((o for o in cerebro.db_ordenes if str(o["numero"]) == num_op), None)
                    
                    if op_encontrada:
                        resultado_busqueda = f"Historial OP-{op_encontrada['numero']}:\n- Total: {op_encontrada['total']}\n- Abono Inicial: {op_encontrada.get('abono_inicial', 'No registra')}\n- Saldo Actual: {op_encontrada['saldo']}\n"
                        
                        if op_encontrada["abonos_extra"]:
                            resultado_busqueda += "\nAbonos Adicionales Registrados:\n"
                            for ab in op_encontrada["abonos_extra"]:
                                resultado_busqueda += f"  * Recibo #{ab['recibo']} | Fecha: {ab['fecha']} | Valor: {ab['valor']} | Link PDF: {ab.get('url_pdf', 'N/A')}\n"
                        else:
                            resultado_busqueda += "\nNo se registran recibos de abonos adicionales."
                    else:
                        resultado_busqueda = f"La Orden de Pedido OP-{num_op} no existe en la base de datos."

                # ==========================================================
                # BLOQUE COMERCIAL (COTIZADOR, CATÁLOGO Y MANUAL PDF)
                # ==========================================================
                elif nombre_funcion == "consultar_manual_pentagrama":
                    tema = argumentos.get("tema", "")
                    if tema in MANUAL_PENTAGRAMA:
                        resultado_busqueda = f"INFORMACIÓN OFICIAL DEL PDF DE PENTAGRAMA:\n{MANUAL_PENTAGRAMA[tema]}\n\nInstrucción para Hommy: Explícale esto al Jefe de forma pedagógica y experta."
                    else:
                        resultado_busqueda = "El manual no tiene información sobre ese tema específico."

                elif nombre_funcion == "cotizar_producto":
                    sys_req = argumentos.get("sistema", "").lower()
                    tela_req = argumentos.get("tela", "").lower()
                    
                    ancho_crudo = float(argumentos.get("ancho", 0))
                    alto_crudo = float(argumentos.get("alto", 0))
                    
                    ancho = ancho_crudo / 100 if ancho_crudo > 10 else ancho_crudo
                    alto = alto_crudo / 100 if alto_crudo > 10 else alto_crudo
                    
                    cant = int(argumentos.get("cantidad", 1))
                    incluir_lujo = argumentos.get("incluir_lujo", False)
                    solo_renueva = argumentos.get("solo_tela_renueva", False)

                    if ancho <= 0 or alto <= 0:
                        resultado_busqueda = "ERROR: El ancho y el alto no pueden ser cero. Pídele las medidas correctas al Jefe."
                        historial_global.append({"role": "tool", "tool_call_id": tool_call.id, "content": resultado_busqueda})
                        continue

                    # Buscar en la BD de Google Sheets
                    producto_encontrado = None
                    for p in db_tarifas:
                        if sys_req in str(p.get("Sistema", "")).lower() and tela_req in str(p.get("Nombre_Tela", "")).lower():
                            producto_encontrado = p
                            break

                    if not producto_encontrado:
                        resultado_busqueda = "ERROR TÉCNICO: No encontré esa tela exacta en la base de datos de Tarifas. Pídele al Jefe que revise el nombre o búscalo en el catálogo."
                    else:
                        precio_base_m2 = float(producto_encontrado.get("Precio_M2", 0))
                        recargo_txt = str(producto_encontrado.get("Recargos_Mecanismo", "Ninguno"))
                        
                        if solo_renueva:
                            precio_base_m2 = float(producto_encontrado.get("Precio_Renueva_M2", 0))
                            if precio_base_m2 <= 0:
                                resultado_busqueda = "ALERTA: Esta tela o sistema no permite plan Renueva (solo tela). Ofrécele venderla completa."
                                historial_global.append({"role": "tool", "tool_call_id": tool_call.id, "content": resultado_busqueda})
                                continue
                        
                        if incluir_lujo and "+" in recargo_txt:
                            try:
                                valor_adicional = float(re.search(r'\+\s*(\d+)', recargo_txt).group(1))
                                precio_base_m2 += valor_adicional
                            except:
                                pass

                        min_m2 = float(producto_encontrado.get("Cobro_Min_M2", 0))
                        min_alto = float(producto_encontrado.get("Cobro_Min_Alto", 0))
                        alto_max = float(producto_encontrado.get("Alto_Maximo", 99))
                        ancho_max = float(producto_encontrado.get("Ancho_Maximo", 99))
                        
                        alto_a_cobrar = max(alto, min_alto)
                        area_a_cobrar = max(ancho * alto_a_cobrar, min_m2)
                        subtotal_material = area_a_cobrar * precio_base_m2 * cant
                        
                        costo_inst_unitario = 50000 if "onda" in sys_req else 30000
                        total_instalacion = costo_inst_unitario * cant
                        
                        subtotal_sin_iva = subtotal_material + total_instalacion
                        iva = subtotal_sin_iva * 0.19
                        total_con_iva = subtotal_sin_iva + iva
                        
                        alertas = []
                        if ancho > ancho_max: 
                            alertas.append(f"¡ALERTA ROJA! El ancho ({ancho}m) supera el ancho del rollo de tela ({ancho_max}m). Es FÍSICAMENTE IMPOSIBLE hacerla en una sola pieza. Debes aconsejarle al Jefe que la divida en dos partes por seguridad.")
                        if alto > alto_max: 
                            alertas.append(f"¡ALERTA TÉCNICA! El alto ({alto}m) supera la capacidad del mecanismo ({alto_max}m).")
                        if "enrollable" in sys_req and alto > (ancho * 3): 
                            alertas.append(f"¡ALERTA EFECTO CONO! (Alto {alto}m es más de 3 veces el ancho {ancho}m). Advierte al Jefe que la tela se tuerce al enrollar.")
                        if "sheer" in sys_req and alto > 3.0:
                            alertas.append("¡ALERTA SHEER ALTA! Supera los 3m de alto. Obligatorio decir que debe usar Cabezal Versátil porque el rollo queda muy gordo.")
                        
                        alertas_txt = "\n- OBSERVACIONES PARA HOMMY: " + " | ".join(alertas) if alertas else "\n- OBSERVACIONES: Medidas perfectas, ninguna alerta técnica."
                        
                        resultado_busqueda = (
                            f"Resultado Cotización Matemática:\n"
                            f"- Sistema: {producto_encontrado.get('Sistema')} | Tela: {producto_encontrado.get('Nombre_Tela')}\n"
                            f"- Medidas procesadas: Ancho {ancho}m x Alto {alto}m\n"
                            f"- Modalidad: {'RENUEVA (Solo Tela)' if solo_renueva else 'CORTINA COMPLETA'}\n"
                            f"- Cabezal Lujo?: {'SÍ (' + recargo_txt + ')' if incluir_lujo else 'NO (Versión Sencilla)'}\n"
                            f"- Área a cobrar: {area_a_cobrar} m2 por unidad\n"
                            f"- Subtotal Materiales ({cant} unds): ${subtotal_material:,.0f}\n"
                            f"- Instalación ({cant} unds): ${total_instalacion:,.0f}\n"
                            f"- IVA (19%): ${iva:,.0f}\n"
                            f"- TOTAL con IVA (Sin transporte): ${total_con_iva:,.0f}\n"
                            f"{alertas_txt}\n"
                            f"INSTRUCCIÓN ESTRICTA PARA HOMMY: Al TOTAL con IVA súmale $50,000 de transporte y dale el GRAN TOTAL al Jefe. Sé muy experto, explícale todo con pedagogía."
                        )

                elif nombre_funcion == "consultar_catalogo":
                    sys_req = argumentos.get("sistema", "").lower()
                    priv_req = argumentos.get("privacidad", "").lower()
                    etiq_req = argumentos.get("etiqueta", "").lower()
                    
                    resultados_crudos = []
                    
                    for p in db_tarifas:
                        match = True
                        if sys_req and sys_req not in str(p.get("Sistema", "")).lower(): match = False
                        if priv_req and priv_req not in str(p.get("Privacidad", "")).lower(): match = False
                        if etiq_req and etiq_req not in str(p.get("Etiqueta_Venta", "")).lower(): match = False
                        if match: resultados_crudos.append(p)
                    
                    if not resultados_crudos and etiq_req:
                        for p in db_tarifas:
                            match = True
                            if sys_req and sys_req not in str(p.get("Sistema", "")).lower(): match = False
                            if priv_req and priv_req not in str(p.get("Privacidad", "")).lower(): match = False
                            if match: resultados_crudos.append(p)

                    if resultados_crudos:
                        resultados_crudos.sort(key=lambda x: float(x.get("Precio_M2", 0)))
                        
                        resultados_txt = []
                        for p in resultados_crudos[:3]:
                            resultados_txt.append(f"- {p.get('Sistema')} {p.get('Nombre_Tela')} (${p.get('Precio_M2'):,.0f}/m2) | Argumento: {p.get('Argumento_Venta')} | Notas Técnicas: {p.get('Notas_Tecnicas')}")
                            
                        resultado_busqueda = "Catálogo Recomendado (las más económicas primero):\n" + "\n".join(resultados_txt) + "\nINSTRUCCIÓN PARA HOMMY: Usa los argumentos para vender. Si es para habitación, añade tus consejos de experto sobre filtración de luz y cabezales."
                    else:
                        resultado_busqueda = "No encontré telas con esas características exactas en la base de datos."

                historial_global.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": resultado_busqueda
                })

            respuesta_final = client.chat.completions.create(
                model="gpt-4o-mini", 
                messages=historial_global, 
                temperature=0.3
            )
            
            texto_final = respuesta_final.choices[0].message.content
            historial_global.append({"role": "assistant", "content": texto_final})
            
            historial_global = limpiar_memoria_segura(historial_global)
            return jsonify({"respuesta": texto_final})

        else:
            historial_global = limpiar_memoria_segura(historial_global)
            return jsonify({"respuesta": mensaje_ia.content})

    except Exception as e:
        traceback.print_exc()
        if historial_global and historial_global[-1]["role"] == "user": 
            historial_global.pop()
        return jsonify({"respuesta": "¡Uy, Jefe! Tuve un pequeño corto circuito buscando eso en mis archivos. ¿Me lo repites?"})

# =====================================================================
# RUTA 2: CUERDAS VOCALES (ELEVENLABS)
# =====================================================================
@app.route('/api/tts', methods=['POST'])
def tts_endpoint():
    datos = request.json
    texto_crudo = datos.get("texto", "")
    
    # Limpieza del texto para que la voz no lea símbolos raros
    texto_limpio = texto_crudo.replace("*", "").replace("#", "")
    texto_limpio = re.sub(r'\[.*?\]\(.*?\)', ' Aquí tienes el documento en pantalla.', texto_limpio)
    texto_limpio = re.sub(r'\(\$[\d\.,\s]+\)', '', texto_limpio)
    texto_limpio = texto_limpio.replace('$', '') 
    
    try:
        print(f" [Voz] Conectando con ElevenLabs... (Voz ID: {VOICE_ID})")
        
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": ELEVENLABS_API_KEY
        }
        data = {
            "text": texto_limpio,
            "model_id": "eleven_multilingual_v2", 
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }
        
        response = requests.post(url, json=data, headers=headers)
        
        if response.status_code != 200:
            print(" [!] Error de ElevenLabs:", response.text)
            return jsonify({"error": "Error conectando con ElevenLabs"}), 500
            
        audio_base64 = base64.b64encode(response.content).decode('utf-8')
        return jsonify({"audio": audio_base64})
    
    except Exception as e:
        print(" [!] Error generando la voz:", e)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("=" * 70)
    print("  [OK] Servidor escuchando en: http://127.0.0.1:5000")
    print("=" * 70)
    app.run(debug=False, port=5000)
