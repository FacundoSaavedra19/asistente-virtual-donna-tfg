import datetime
import random
import re
import unicodedata
from urllib.parse import quote_plus

DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
          "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

JOKES = [
    "¿Qué le dice un bit a otro? Nos vemos en el bus.",
    "¿Por qué el libro de matemáticas estaba triste? Porque tenía muchos problemas.",
    "¿Cuál es el café más peligroso del mundo? El ex-preso.",
    "¿Qué hace una abeja en el gimnasio? Zumba.",
    "¿Cómo se despiden los químicos? Ácido un placer.",
]

HELP_TEXT = ("Puedo decirte la hora, el día o la fecha, abrir YouTube, Google o Wikipedia, "
             "buscar en Google, hacer cuentas sencillas y contarte un chiste.")

NOT_UNDERSTOOD = "Perdón, no entendí el pedido"

# Numbers the speech recognizer may write as words instead of digits.
NUMBER_WORDS = {
    "cero": 0, "uno": 1, "una": 1, "un": 1, "dos": 2, "tres": 3, "cuatro": 4,
    "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
    "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
    "dieciseis": 16, "diecisiete": 17, "dieciocho": 18, "diecinueve": 19,
    "veinte": 20, "treinta": 30, "cuarenta": 40, "cincuenta": 50,
    "sesenta": 60, "setenta": 70, "ochenta": 80, "noventa": 90, "cien": 100,
}

# Spoken operator -> (symbol, word used in the answer).
OPERATORS = {
    "mas": ("+", "más"), "+": ("+", "más"),
    "menos": ("-", "menos"), "-": ("-", "menos"),
    "por": ("*", "por"), "x": ("*", "por"), "*": ("*", "por"),
    "entre": ("/", "entre"), "dividido": ("/", "entre"), "/": ("/", "entre"),
}


def normalize(text):
    """Lowercases, removes accents and punctuation: '¿Qué Día es?' -> 'que dia es'."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    no_accents = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    no_punctuation = re.sub(r"[^a-z0-9ñ+\-*/ ]", " ", no_accents)
    return " ".join(no_punctuation.split())


def has_any(text, phrases):
    """True if any of the phrases appears in the text as whole words."""
    padded = f" {text} "
    return any(f" {phrase} " in padded for phrase in phrases)


def to_number(word):
    if word.isdigit():
        return int(word)
    return NUMBER_WORDS.get(word)


def format_number(value):
    if value == int(value):
        return str(int(value))
    return f"{value:.2f}".rstrip("0").replace(".", " coma ")


class Commands:
    """Maps a question to an answer, an optional action and the command name."""

    def execute(self, question):
        text = normalize(question or "")
        if not text:
            return self._reply(NOT_UNDERSTOOD, command="no_reconocido")

        # The order matters: the more specific commands go first.
        if has_any(text, ["que fecha", "a que dia estamos", "fecha de hoy"]):
            return self._date()
        if has_any(text, ["que hora", "la hora", "hora actual"]):
            return self._time()
        if has_any(text, ["que dia", "el dia", "dia de hoy"]):
            return self._day()

        search = re.search(r"\bbusca(?:r)?(?: en google)? (.+)", text)
        if search:
            return self._search(search.group(1))

        if has_any(text, ["youtube"]) and has_any(text, ["abre", "abrir", "quiero ver", "pon"]):
            return self._open("YouTube", "https://www.youtube.com")
        if has_any(text, ["google"]) and has_any(text, ["abre", "abrir"]):
            return self._open("Google", "https://www.google.com")
        if has_any(text, ["wikipedia"]) and has_any(text, ["abre", "abrir"]):
            return self._open("Wikipedia", "https://es.wikipedia.org")

        calculation = self._calculate(text)
        if calculation:
            return calculation

        if has_any(text, ["que puedes hacer", "que sabes hacer", "ayuda", "ayudame"]):
            return self._reply(HELP_TEXT, command="ayuda")
        if has_any(text, ["quien eres", "como te llamas", "tu nombre"]):
            return self._reply("Soy Donna, tu asistente virtual", command="presentacion")
        if has_any(text, ["chiste"]):
            return self._reply(random.choice(JOKES), command="chiste")
        if has_any(text, ["hola", "buenos dias", "buenas tardes", "buenas noches"]):
            return self._reply("Hola, soy Donna. ¿En qué te ayudo?", command="saludo")

        return self._reply(NOT_UNDERSTOOD, command="no_reconocido")

    def _time(self):
        now = datetime.datetime.now()
        start = "Es la una" if now.hour == 1 else f"Son las {now.hour}"
        if now.minute == 0:
            end = " en punto"
        elif now.minute == 1:
            end = " y un minuto"
        else:
            end = f" y {now.minute} minutos"
        return self._reply(start + end, command="hora")

    def _day(self):
        today = datetime.date.today()
        return self._reply(f"Hoy es {DAYS[today.weekday()]}", command="dia")

    def _date(self):
        today = datetime.date.today()
        answer = (f"Hoy es {DAYS[today.weekday()]} {today.day} de "
                  f"{MONTHS[today.month - 1]} de {today.year}")
        return self._reply(answer, command="fecha")

    def _open(self, name, url):
        action = {"type": "open_url", "url": url}
        return self._reply(f"Abriendo {name}", action, command=f"abrir_{name.lower()}")

    def _search(self, query):
        url = "https://www.google.com/search?q=" + quote_plus(query)
        action = {"type": "open_url", "url": url}
        return self._reply(f"Buscando {query}", action, command="buscar")

    def _calculate(self, text):
        """Understands 'cuanto es 5 mas 3', '7 por 8' or 'nueve menos cuatro'."""
        words = text.replace("dividido por", "entre").replace("dividido entre", "entre").split()
        for i in range(1, len(words) - 1):
            if words[i] not in OPERATORS:
                continue
            a, b = to_number(words[i - 1]), to_number(words[i + 1])
            if a is None or b is None:
                continue
            symbol, spoken = OPERATORS[words[i]]
            if symbol == "/" and b == 0:
                return self._reply("No se puede dividir entre cero", command="calculadora")
            result = {"+": a + b, "-": a - b, "*": a * b, "/": a / b if b else 0}[symbol]
            answer = f"{a} {spoken} {b} son {format_number(result)}"
            return self._reply(answer, command="calculadora")
        return None

    def _reply(self, answer, action=None, command=None):
        return {"answer": answer, "action": action, "command": command}