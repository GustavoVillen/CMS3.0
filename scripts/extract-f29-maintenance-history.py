import zipfile, re, sys, os, json

DIR = r'C:\CMS3.0\MisDocs\MAO01\HistorialF29'
FILES = [
    'F-29 HISTORIAL DE MANTENIMIENTO CAJA BR.docx',
    'F-29 HISTORIAL DE MANTENIMIENTO CAJA ER.docx',
    'F-29 HISTORIAL DE MANTENIMIENTO Compresor Rotativo CETEC.docx',
    'F-29 HISTORIAL DE MANTENIMIENTO Línea de eje Br.docx',
    'F-29 HISTORIAL DE MANTENIMIENTO Línea de eje Er.docx',
    'F-29 HISTORIAL DE MANTENIMIENTO MG Br.docx',
    'F-29 HISTORIAL DE MANTENIMIENTO MG Er-.docx',
    'F-29 HISTORIAL DE MANTENIMIENTO MP Br.docx',
    'F-29 HISTORIAL DE MANTENIMIENTO MP Er.docx',
    'F-29-MAO 01-HIST DE MANT SIST HIDRAUL DE GOBIERNO Y MANIOBRA-MAO 01.docx',
]

NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def get_text_of_cell(cell_xml):
    # extract all w:t contents in order, including handling w:tab, w:br as separators
    parts = []
    # split into tokens: w:t...</w:t>, <w:tab/>, <w:br/>
    for m in re.finditer(r'<w:t(?![a-zA-Z])[^>]*>(.*?)</w:t>|(<w:tab/>)|(<w:br/>)|(<w:cr/>)', cell_xml, re.S):
        if m.group(1) is not None:
            parts.append(m.group(1))
        elif m.group(2):
            parts.append('\t')
        elif m.group(3):
            parts.append('\n')
        elif m.group(4):
            parts.append('\n')
    text = ''.join(parts)
    # unescape basic xml entities
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&apos;', "'")
    return text.strip()

def extract_table_rows(xml):
    rows_out = []
    # find all table rows <w:tr ...>...</w:tr> (non-greedy, but rows can contain nested tables rarely; assume not)
    for tr_m in re.finditer(r'<w:tr\b.*?</w:tr>', xml, re.S):
        tr_xml = tr_m.group(0)
        cells = []
        for tc_m in re.finditer(r'<w:tc\b.*?</w:tc>', tr_xml, re.S):
            tc_xml = tc_m.group(0)
            cells.append(get_text_of_cell(tc_xml))
        if cells:
            rows_out.append(cells)
    return rows_out

def main():
    results = {}
    for fname in FILES:
        path = os.path.join(DIR, fname)
        with zipfile.ZipFile(path) as z:
            xml = z.read('word/document.xml').decode('utf-8', errors='replace')
        rows = extract_table_rows(xml)
        results[fname] = rows
        print(f"=== {fname} === rows: {len(rows)}")
        for r in rows[:5]:
            print(r)
        print('...')
    with open(os.path.join('C:\\CMS3.0\\scripts\\out', 'f29-extracted.json'), 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
