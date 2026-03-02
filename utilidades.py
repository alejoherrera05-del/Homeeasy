import unicodedata


def formato_moneda(valor):
    try:
        if valor == "" or valor is None:
            return "$0"
        num = float(
            str(valor)
            .replace("$", "")
            .replace(".", "")
            .replace(",", "")
            .strip()
        )
        return f"${int(num):,}".replace(",", ".")
    except:
        return "$0"


def safe_get(lista, indice, default=""):
    try:
        val = lista[indice] if len(lista) > indice else default
        return str(val).strip() if val is not None else default
    except:
        return default


def normalizar(texto):
    texto = str(texto).lower().strip()
    return "".join(
        c
        for c in unicodedata.normalize("NFD", texto)
        if unicodedata.category(c) != "Mn"
    )