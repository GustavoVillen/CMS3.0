# Survey Status de clase → Plan de Mantenimiento

Cadena que convierte los Ship Status / Survey Status que emiten las sociedades de
clasificación en el dataset que carga los planes de inspección de clase.

Los PDF de origen viven en `MisDocs\Survey Status` (uno por buque, más el
certificado de clase que **no** se usa: la fecha buena es la de la inspección que
informa el Ship Status, no la de emisión del certificado).

| Archivo | Qué hace |
|---|---|
| `survey_status_parser.py` | Lee los PDF y extrae la tabla de inspecciones. Dos formatos: RINA (`CLASS SURVEYS`, columnas por posición) y ClassNK (`NK-SHIPS`, texto en negrita con caracteres duplicados). |
| `build_class_survey_plans.py` | Arma `../class-survey-plans.json`: por buque, los cinco ítems de clase con última ejecución, vencimiento y frecuencia. Ese JSON lo consume `scripts/load-fleet-class-inspections.ts`. |
| `build_survey_status_excel.py` | Arma la planilla `MisDocs\Survey Status\Survey Status Flota.xlsx` para lectura humana (semáforo de vencimientos + hoja de detalle). |

## Cómo regenerar cuando llegan Ship Status nuevos

```bash
pip install pdfplumber openpyxl          # una sola vez
cd scripts/data/survey-status
python build_class_survey_plans.py       # regenera el JSON y muestra la tabla
python build_survey_status_excel.py      # regenera el Excel

cd ../../..
DRY=1 npx tsx scripts/load-fleet-class-inspections.ts   # previsualiza
npx tsx scripts/load-fleet-class-inspections.ts         # aplica
```

## Reglas de cálculo

* **Última ejecución**: columna `LAST DATE` del Ship Status. Si no figura, queda vacía.
* **Vencimiento**: columna `DUE DATE`; si no hay, el cierre de la ventana (`RANGE DATES`);
  si tampoco hay, se proyecta sobre el ciclo de clase siguiente, que arranca en la fecha
  de vencimiento de la renovación (periódica = +24 m, intermedia = +48 m). La proyección
  se verificó contra MGT 01 y MGT 17, que renovaron en 2026 y sí traen el dato.
* **Frecuencia**: del ciclo de clase que declara el certificado (`Class period`), no de la
  resta entre las dos fechas — suelen caer en ciclos distintos y la resta daría un número
  falso. Remolcadores 6 años, barcazas 8 años. Renovación y seco = ciclo, intermedia =
  ciclo/2, periódica = ciclo/4 donde el certificado la registra y 12 meses donde no.
  El eje portahélice tiene ciclo propio y sale de sus propias fechas.

## Cobertura

31 buques con Ship Status: los 4 remolcadores y las 27 barcazas MGT. Quedan afuera
GLT 001/007/008 y YT 010/012/013, que no tienen Ship Status en la carpeta.
