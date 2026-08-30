import json, re

with open(r'C:\CMS3.0\scripts\out\f29-extracted.json', encoding='utf-8') as f:
    d = json.load(f)

KNOWN_TYPO_FIXES = {
    '24/24/2025 08:30': '24/04/2025 08:30',  # context: between 19/04/2025 and 26/04/2025
    '13/12/2028 08:00': '13/12/2025 08:00',  # context: between 06/12/2025 and 20/12/2025 -> year typo
    '08/05/206 09:00': '08/05/2026 09:00',  # context: between 01/05/2026 and 15/05/2026 -> missing digit in year
}

def normalize(raw):
    s = raw.strip()
    if not s:
        return None, 'empty'
    orig = s
    note = None

    if s in KNOWN_TYPO_FIXES:
        s2 = KNOWN_TYPO_FIXES[s]
        note = f'SOURCE TYPO fixed via context: "{orig}" -> "{s2}"'
        s = s2

    # fix garbled "dd:mm/yy hh:mm" -> "dd/mm/yy hh:mm"
    m = re.match(r'^(\d{1,2}):(\d{1,2})/(\d{2,4})\s+(\d{1,2}):(\d{2})$', s)
    if m:
        dd, mm, yy, hh, mi = m.groups()
        s2 = f'{dd}/{mm}/{yy} {hh}:{mi}'
        note = f'typo fixed: "{orig}" -> "{s2}"'
        s = s2

    # collapse double slashes
    if '//' in s:
        s2 = s.replace('//', '/')
        note = (note + '; ' if note else '') + f'double-slash fixed: "{orig}" -> "{s2}"'
        s = s2

    # semicolon as time separator
    if re.search(r'\d{1,2};\d{2}$', s):
        s2 = re.sub(r'(\d{1,2});(\d{2})$', r'\1:\2', s)
        note = (note + '; ' if note else '') + f'semicolon time fixed: "{orig}" -> "{s2}"'
        s = s2

    # single digit minute "18:0" -> "18:00"
    m = re.match(r'^(.*\d{1,2}:)(\d)$', s)
    if m:
        s2 = m.group(1) + '0' + m.group(2)
        note = (note + '; ' if note else '') + f'minute padded: "{orig}" -> "{s2}"'
        s = s2

    # trailing junk like "HS" after time
    m = re.match(r'^(\d{1,2}/\d{1,2}/\d{2,4}(?:\s+\d{1,2}:\d{2})?)\s*[A-Za-z]+$', s)
    if m:
        s2 = m.group(1)
        note = (note + '; ' if note else '') + f'trailing text stripped: "{orig}" -> "{s2}"'
        s = s2

    # ranges "dd/mm/yy[yy] [hh:mm] (al|a|y) dd/mm/yy[yy] [hh:mm]" -> take first date(+time), keep full text as note
    m = re.match(r'^(\d{1,2}/\d{1,2}/\d{2,4})\s*(\d{1,2}[:.]\d{2})?\s+(al|a|y)\s+(\d{1,2}/\d{1,2}/\d{2,4})\s*(\d{1,2}[:.]\d{2})?$', s)
    if m:
        note = (note + '; ' if note else '') + f'date range in source: "{orig}" (using start date)'
        s = m.group(1) + (' ' + m.group(2) if m.group(2) else '')

    # missing slash before year+time glued (dot separator): dd/mm followed by 2-digit-year+2-digit-hour+.mm  e.g. 28/05/2507.00
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2})(\d{2})\.(\d{2})$', s)
    if m:
        dd, mm, yy, hh, mi = m.groups()
        s2 = f'{dd}/{mm}/{yy} {hh}:{mi}'
        note = (note + '; ' if note else '') + f'glued date/time fixed: "{orig}" -> "{s2}"'
        s = s2

    # missing slash/space before time glued (colon separator), 2-digit year: dd/mm/yyHH:MM
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2})(\d{2}):(\d{2})$', s)
    if m:
        dd, mm, yy, hh, mi = m.groups()
        s2 = f'{dd}/{mm}/{yy} {hh}:{mi}'
        note = (note + '; ' if note else '') + f'glued date/time fixed: "{orig}" -> "{s2}"'
        s = s2

    # missing slash/space before time glued (colon separator), 4-digit year: dd/mm/yyyyHH:MM
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})(\d{2}):(\d{2})$', s)
    if m:
        dd, mm, yyyy, hh, mi = m.groups()
        s2 = f'{dd}/{mm}/{yyyy} {hh}:{mi}'
        note = (note + '; ' if note else '') + f'glued date/time fixed: "{orig}" -> "{s2}"'
        s = s2

    # missing slash: dd/mmyyyy hh:mm  e.g. 31/052026 08:00
    m = re.match(r'^(\d{1,2})/(\d{2})(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$', s)
    if m:
        dd, mm, yyyy, hh, mi = m.groups()
        s2 = f'{dd}/{mm}/{yyyy}' + (f' {hh}:{mi}' if hh else '')
        note = (note + '; ' if note else '') + f'missing slash fixed: "{orig}" -> "{s2}"'
        s = s2

    # standard: dd/mm/yy[yy] optional time with : or . separator
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})(?:\s+(\d{1,2})[:.](\d{2}))?$', s)
    if not m:
        return None, f'UNPARSEABLE: "{orig}"'
    dd, mm, yy, hh, mi = m.groups()
    yy = int(yy)
    if yy < 100:
        yy += 2000
    dd, mm = int(dd), int(mm)
    hh = int(hh) if hh else 0
    mi = int(mi) if mi else 0
    try:
        key = (yy, mm, dd, hh, mi)
    except:
        return None, f'UNPARSEABLE: "{orig}"'
    if mm > 12 or dd > 31:
        return None, f'UNPARSEABLE (bad day/month): "{orig}"'
    date_str = f'{dd:02d}/{mm:02d}/{yy}' + (f' {hh:02d}:{mi:02d}' if (hh or mi or (':' in orig or '.' in orig.split("/")[-1] if '/' in orig else False)) else '')
    return (key, date_str, note), None

EQUIP_NAMES = {
    'F-29 HISTORIAL DE MANTENIMIENTO CAJA BR.docx': 'Caja reductora Br',
    'F-29 HISTORIAL DE MANTENIMIENTO CAJA ER.docx': 'Caja reductora Er',
    'F-29 HISTORIAL DE MANTENIMIENTO Compresor Rotativo CETEC.docx': 'Compresor Rotativo CETEC',
    'F-29 HISTORIAL DE MANTENIMIENTO L\u00ednea de eje Br.docx': 'L\u00ednea de eje Br',
    'F-29 HISTORIAL DE MANTENIMIENTO L\u00ednea de eje Er.docx': 'L\u00ednea de eje Er',
    'F-29 HISTORIAL DE MANTENIMIENTO MG Br.docx': 'Motor Generador Br',
    'F-29 HISTORIAL DE MANTENIMIENTO MG Er-.docx': 'Motor Generador Er',
    'F-29 HISTORIAL DE MANTENIMIENTO MP Br.docx': 'Motor Propulsor Br',
    'F-29 HISTORIAL DE MANTENIMIENTO MP Er.docx': 'Motor Propulsor Er',
    'F-29-MAO 01-HIST DE MANT SIST HIDRAUL DE GOBIERNO Y MANIOBRA-MAO 01.docx': 'Sistema Hidr\u00e1ulico de Gobierno y Maniobra',
}

out = []
for fname, rows in d.items():
    equip = EQUIP_NAMES.get(fname, fname)
    clean = [r for r in rows if len(r) == 2 and 'Fecha' not in r[0]]
    entries = []
    problems = []
    for r in clean:
        parsed, err = normalize(r[0])
        if parsed is None:
            if err != 'empty':
                problems.append((r[0], r[1], err))
            continue
        key, date_str, note = parsed
        entries.append((key, date_str, r[1].strip(), note))
    entries.sort(key=lambda x: x[0])

    out.append(f'\n{"="*90}\nEQUIPO: {equip}  ({fname})\nTotal entradas parseadas: {len(entries)}  |  No parseadas/omitidas: {len(problems)}\n{"="*90}')
    for key, date_str, desc, note in entries:
        line = f'{date_str} | {desc}'
        if note:
            line += f'   [{note}]'
        out.append(line)
    if problems:
        out.append('\n-- FILAS NO PARSEADAS (revisar manualmente) --')
        for raw_date, desc, err in problems:
            out.append(f'  raw="{raw_date}" | desc="{desc}" | {err}')
    if entries:
        out.append(f'\n>>> FECHA MAS RECIENTE: {entries[-1][1]} -- {entries[-1][2]}')

with open(r'C:\CMS3.0\scripts\out\f29-full-report.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))

print('DONE. Lines:', len(out))
