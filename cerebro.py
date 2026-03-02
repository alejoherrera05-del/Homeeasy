import time
from datetime import datetime
from utilidades import formato_moneda, safe_get, normalizar


def conectar_hoja(archivo, hoja, intentos=3):
    for i in range(intentos):
        try:
            return archivo.worksheet(hoja).get_all_values()
        except:
            print(f"  Reintentando {hoja}... ({i+1}/{intentos})")
            time.sleep(2)
    raise Exception(f"No se pudo conectar a: {hoja}")


class CerebroHommy:
    def __init__(self):
        self.db_clientes = {}
        self.db_abonos = {}
        self.db_cotizaciones = []
        self.db_ordenes = []
        self.db_agenda = []
        self.fecha_hoy = datetime.now().strftime("%Y-%m-%d")

    def cargar_datos(self, archivo):
        print("\n[HOMMY V5] Cargando datos...")
        datos_cli = conectar_hoja(archivo, "Clientes")
        datos_cot = conectar_hoja(archivo, "Cotizaciones")
        datos_op = conectar_hoja(archivo, "Ordenes_Pedido")
        datos_ab = conectar_hoja(archivo, "Abonos")
        datos_ag = conectar_hoja(archivo, "Agenda")
        print("  Datos descargados...")

        for c in datos_cli[1:]:
            ced = safe_get(c, 0)
            if not ced:
                continue
            self.db_clientes[ced] = {
                "nombre": safe_get(c, 1),
                "telefono": safe_get(c, 2),
                "email": safe_get(c, 3),
                "direccion": safe_get(c, 4),
                "cotizaciones": [],
                "ordenes": [],
            }

        for ab in datos_ab[1:]:
            nop = safe_get(ab, 1)
            if not nop:
                continue
            if nop not in self.db_abonos:
                self.db_abonos[nop] = []
            self.db_abonos[nop].append({
                "recibo": safe_get(ab, 0),
                "fecha": safe_get(ab, 4),
                "valor": safe_get(ab, 5),
                "medio": safe_get(ab, 6),
                "url_pdf": safe_get(ab, 7), # Columna H
            })

        for cot in datos_cot[1:]:
            cc = safe_get(cot, 2)
            nc = safe_get(cot, 0)
            if not nc or nc == "":
                continue
            obj = {
                "numero": nc,
                "fecha": safe_get(cot, 1),
                "cedula": cc,
                "nombre": safe_get(cot, 3),
                "descripcion": safe_get(cot, 4),
                "total": safe_get(cot, 6),
                "estado": safe_get(cot, 9, "COTIZACION"),
                "url_pdf": safe_get(cot, 7), # Columna H
            }
            self.db_cotizaciones.append(obj)
            if cc in self.db_clientes:
                self.db_clientes[cc]["cotizaciones"].append(obj)

        for op in datos_op[1:]:
            co = safe_get(op, 2)
            nop = safe_get(op, 1)
            if not nop or nop == "":
                continue
            obj = {
                "numero": nop,
                "fecha": safe_get(op, 0),
                "cedula": co,
                "nombre": safe_get(op, 3),
                "descripcion": safe_get(op, 4),
                "total": safe_get(op, 6),
                "abono_inicial": safe_get(op, 7),
                "saldo": safe_get(op, 10),
                "estado": safe_get(op, 11, "ACTIVO"),
                "abonos_extra": self.db_abonos.get(nop, []),
                "url_pdf": safe_get(op, 12), # Columna M
            }
            self.db_ordenes.append(obj)
            if co in self.db_clientes:
                self.db_clientes[co]["ordenes"].append(obj)

        for t in datos_ag[1:]:
            tid = safe_get(t, 0)
            if not tid or tid == "":
                continue
            self.db_agenda.append({
                "fecha": safe_get(t, 1),
                "hora": safe_get(t, 2),
                "categoria": safe_get(t, 3),
                "titulo": safe_get(t, 4),
                "cliente": safe_get(t, 5),
                "estado": safe_get(t, 7),
            })

        nc = len(self.db_clientes)
        no = len(self.db_ordenes)
        na = len(self.db_agenda)
        print(f"  Listo: {nc} clientes | {no} OPs | {na} eventos\n")