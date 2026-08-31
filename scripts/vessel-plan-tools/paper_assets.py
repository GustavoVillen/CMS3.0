# -*- coding: utf-8 -*-
"""Resuelve el equipo que nombra la planilla en papel contra los activos del CMS3.

Las planillas del MAO 01 y del LATERE no traen codigo de activo: nombran el equipo
en texto libre y con las abreviaturas de a bordo ("MOTOR PPAL BABOR", "MM.AA. N°1",
"Bba. de Incendio Ppal", "Electrobomba de Trasvase"). Del otro lado, el CMS3 tiene
el activo con su nombre completo ("Motor Principal Babor", "Bomba de Incendio
Principal"). Esto empareja los dos.

Se eligio puntuar por palabras en vez de escribir un diccionario a mano por buque
(el del MAO 02 tiene 50 entradas) porque para una AUDITORIA lo que no engancha es
justamente parte del resultado: mejor listarlo que forzarlo. Todo equipo que no
llega al umbral se devuelve como no resuelto y se publica en la hoja "Sin mapear".

El lado del banda/numero es excluyente: "Motor Principal Babor" no puede resolver
contra el activo de estribor aunque el resto del nombre coincida entero.
"""
import re
import unicodedata

# Abreviaturas de a bordo -> palabra completa. Se aplican sobre texto ya
# normalizado (sin tildes, minusculas) y como palabra entera.
ALIAS = {
    "ppal": "principal", "ppales": "principales", "pral": "principal",
    "mp": "motor principal", "mmpp": "motor principal", "mpp": "motor principal",
    "ma": "motor auxiliar", "mmaa": "motor auxiliar", "maa": "motor auxiliar",
    "mg": "motor generador", "mmgg": "motor generador",
    "bba": "bomba", "bbas": "bomba", "eb": "bomba", "mbba": "bomba",
    "electrobomba": "bomba", "motobomba": "bomba",
    "cr": "caja reductora", "alt": "alternador", "comp": "compresor",
    "tep": "tablero electrico principal", "ega": "emergencia",
    "aa": "aire acondicionado", "a/a": "aire acondicionado",
    "sist": "sistema", "elect": "electrico", "electr": "electrico",
    "hid": "hidraulica", "hidr": "hidraulica", "refrig": "refrigeracion",
    "comb": "combustible", "go": "gasoil", "lo": "lubricante",
    "nav": "navegacion", "vhf": "radio vhf", "ext": "extractor",
    "vent": "ventilador", "trasv": "trasvase", "sanid": "sanidad",
    "inc": "incendio", "lci": "incendio", "sent": "sentina",
    "cabr": "cabrestante", "helice": "helice", "term": "termotanque",
}

# Marcas de banda y numero: si aparecen de los dos lados tienen que coincidir.
BANDAS = [
    ("babor", r"\bbabor\b|\bbb\b|\bbr\b|\bbab\b"),
    ("estribor", r"\bestribor\b|\beb\b|\ber\b|\bestr\b"),
    ("puerto", r"\bpuerto\b|\bpto\b"),
]


def _sin_tildes(s):
    s = unicodedata.normalize("NFKD", str(s))
    return "".join(c for c in s if not unicodedata.combining(c))


def normalizar(s):
    """Texto a palabras comparables: sin tildes, sin puntuacion, en minusculas."""
    s = _sin_tildes(s or "").lower()
    s = s.replace("º", " ").replace("°", " ").replace("nro", "n").replace("n°", "n ")
    s = re.sub(r"[^a-z0-9#]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _raiz(w):
    """Plural a singular, a lo bruto: ventiladores -> ventilador, luces -> luc."""
    if len(w) > 5 and w.endswith("es"):
        return w[:-2]
    if len(w) > 4 and w.endswith("s"):
        return w[:-1]
    return w


# Palabras de relleno: no distinguen una tarea de otra y, al contarlas, hunden la
# precision de los titulos largos del papel contra los cortos del sistema.
VACIAS = {"las", "los", "una", "unas", "unos", "del", "con", "por", "para", "que",
          "sus", "the", "and", "segun", "cada", "todo", "toda", "todos", "todas"}


def _palabras(s):
    out = []
    for w in normalizar(s).split():
        out.extend(ALIAS.get(w, w).split())
    # las muy cortas no aportan (de, la, y, n)
    return [_raiz(w) for w in out if (len(w) > 2 or w.isdigit()) and w not in VACIAS]


def _banda(texto):
    t = normalizar(texto)
    return {nombre for nombre, rx in BANDAS if re.search(rx, t)}


def _numeros(texto):
    """Numeros de equipo: '#1', 'N°3', 'N01' -> {'1'}, {'3'}. Ignora modelos."""
    t = normalizar(texto)
    return {n.lstrip("0") or "0" for n in re.findall(r"(?:#|\bn)\s*(\d{1,2})\b", t)}


class Resolvedor:
    """Empareja nombres de equipo del papel contra los activos de un buque."""

    def __init__(self, activos, umbral=0.50, forzados=()):
        """activos: [{assetCode, name}, ...] del buque, ya sin los dados de baja.

        `forzados` son pares (regex sobre el equipo del papel, assetCode) para los
        casos que el puntaje no puede resolver y una persona ya verifico contra la
        lista de activos. Se prueban antes que el puntaje. Deliberadamente cortos:
        cada entrada es una decision manual y tiene que poder justificarse.
        """
        self.umbral = umbral
        self.forzados = [(re.compile(rx, re.I), code) for rx, code in forzados]
        self.activos = []
        for a in activos:
            # Se puntua contra el NOMBRE, no contra nombre+codigo: meter el codigo
            # en la bolsa de palabras diluye el puntaje (el activo "AIS" pasaba a
            # tener {ais, m01, 4, 001} y una coincidencia perfecta daba 0.40).
            # La banda y el numero si se leen tambien del codigo, que es donde a
            # veces esta el unico "BR"/"#3" del activo.
            texto = "%s %s" % (a["name"], a["assetCode"])
            # Segunda bolsa con marca y modelo: buena parte de la hoja de
            # navegacion nombra el equipo solo por su modelo ("FURUNO M1934 BB",
            # "IC-M412", "DANFORTH"), que no se parece en nada al nombre del
            # activo pero coincide exacto con su ficha.
            ficha = " ".join(filter(None, [a["name"], a.get("manufacturer"), a.get("model")]))
            self.activos.append(dict(
                code=a["assetCode"], name=a["name"],
                palabras=set(_palabras(a["name"])),
                ficha=set(_palabras(ficha)),
                banda=_banda(texto), numeros=_numeros(texto)))
        self.fallidos = {}

    def _puntaje(self, pal, banda, nums, act, campo="palabras"):
        bolsa = act[campo]
        if not pal or not bolsa:
            return 0.0
        # Banda y numero mandan: si los dos lados la declaran y no coinciden, no
        # son el mismo equipo por mas que el resto del nombre sea identico.
        if banda and act["banda"] and not (banda & act["banda"]):
            return 0.0
        if nums and act["numeros"] and not (nums & act["numeros"]):
            return 0.0
        comunes = len(pal & bolsa)
        if not comunes:
            return 0.0
        # F2 y no F1: pesa mas cubrir el nombre del activo que ser conciso, porque
        # el papel casi siempre agrega marca, modelo y numero de serie
        # ("ElectroBomba de Incendio Principal Grundfoss 32-4-22" contra el activo
        # "Bomba de Incendio Principal"). Con F1 esas filas quedaban afuera.
        prec = comunes / len(pal)
        rec = comunes / len(bolsa)
        f2 = 5 * prec * rec / (4 * prec + rec)
        if banda and act["banda"] and (banda & act["banda"]):
            f2 += 0.12
        if nums and act["numeros"] and (nums & act["numeros"]):
            f2 += 0.12
        return f2

    def resolver(self, *textos):
        """Empareja ese equipo con un activo del buque.

        Se pueden pasar varios textos (equipo y grupo de la planilla, por ejemplo):
        se prueban en orden y gana el primero que llegue al umbral. Para cada uno
        se prueba primero contra el nombre del activo y despues contra su ficha
        (nombre + marca + modelo).

        Devuelve (assetCode, puntaje, via, ambiguo). `ambiguo` avisa que otro
        activo empataba en puntaje: el equipo quedo asignado a uno de los dos y
        hay que mirarlo a mano ("IC-M412" es el modelo de las dos radios VHF).
        """
        # La tabla se prueba SOLO contra el primer texto, que es el equipo. Si se
        # probara tambien contra el titulo de grupo, "COCINA" y "TERMOTANQUE"
        # (que en el MAO 01 cuelgan del grupo "VENTILADORES Y EXTRACTORES")
        # terminarian asignados al activo de los ventiladores.
        if textos and textos[0]:
            for rx, code in self.forzados:
                if rx.search(textos[0]):
                    return code, 1.0, "tabla", False

        mejor_global = 0.0
        for texto in textos:
            if not texto:
                continue
            pal, banda, nums = set(_palabras(texto)), _banda(texto), _numeros(texto)
            for campo, via in (("palabras", "nombre"), ("ficha", "marca/modelo")):
                puntajes = []
                for act in self.activos:
                    p = self._puntaje(pal, banda, nums, act, campo)
                    if p > 0:
                        puntajes.append((p, act["code"]))
                if not puntajes:
                    continue
                puntajes.sort(reverse=True)
                mejor, cual = puntajes[0]
                mejor_global = max(mejor_global, mejor)
                if mejor >= self.umbral:
                    ambiguo = len(puntajes) > 1 and abs(puntajes[1][0] - mejor) < 1e-9
                    return cual, round(mejor, 3), via, ambiguo
        self.fallidos[textos[0] if textos else ""] = round(mejor_global, 3)
        return None, round(mejor_global, 3), None, False
