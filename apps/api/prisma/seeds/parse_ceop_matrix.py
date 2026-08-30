#!/usr/bin/env python3
"""
Parse CEOP matrix from tab-separated format to JSON requirements
"""

import json
import re

# Ranks in order
ranks = ["CMD", "IME", "OF_NAU", "CHF_MAQ", "SBCHF_MAQ", "OF_MAQ", "GUIN", "TEC_ENF", "TEC_SEG_OFF", "ELET", "ELET_ADM", "SOLD", "COND_MAQ", "MAR_MAQ", "MOC_MAQ", "MES_CAB", "CONTRA", "MAR_CONV", "MOC_CONV", "COZIN", "TAIF", "PON", "POM"]

# Training item codes in order
items = ["CIR", "DP_REST", "DP_FULL", "DP_AVANC", "DP_BASICO", "EROG", "EARP", "TBS_I", "EBCP", "EOPN", "ESPM_EESS", "EERR", "ECIA_CACI", "EPSM", "ESCM", "CERT_DPC_1031", "CAAQ", "STCW_II_4", "STCW_III_4", "STCW_III_5", "STCW_III_7", "STCW_II_5", "EGPO", "EOCA", "EPOE", "CHEF_LID", "CBSP", "COREN", "CREA", "BIOSEG", "SOLD_TEC", "GUIN_OFF", "NR_10", "NR_12", "NR_32", "NR_33", "NR_33_REVAL", "NR_34_SINAI", "NR_34_COMP", "NR_34_HIDRO", "NR_34_QUENTE_MP", "NR_34_QUENTE_SOLDA", "NR_34_QUENTE_OBS", "NR_34_PINTURA", "NR_34_DESIGNADO", "NR_34_ESTAN", "NR_34_ESTAN_REVAL", "NR_30_34_ADMIS", "NR_30_34_PERIOD", "NR_35_ALTURA", "NR_35_ALTURA_REVAL", "NR_33_35_RESGATE", "DRILL_CUTTING", "OMD_VISATRON", "DP_TEC_GE", "OIL_SPILL", "DREW_QUIM", "IPIRANGA_OLEO", "SOLDA_ELET", "IAS", "OXICORTE", "ICAF_IPRESSA", "ECDIS_FURUNO", "ECDIS_JRC", "ECDIS_SPERRY", "ECDIS_TECDIS", "ECDIS_TRANSAS", "ECDIS_WARTSILA", "MANOBR_BASE", "MANOBR_AZIM", "MANOBR_CONV", "ANCORA_BASICO", "ANCORA_CONV", "ANCORA_OPER", "GUINCHOS_HUISMAN", "GUINCHOS_RR", "ESTAB_AHTS", "ESTAB_PSV", "CRISE", "DP_ATUAL", "DP_EMERG", "DP_FAM_BASE", "DP_FAM_ICON2X", "DP_FAM_ICON3X", "DP_FAM_GE", "DP_FAM_MT", "DP_FAM_TEC", "DP_MAINT_KPOS", "DP_MAINT_ICON", "DP_TEC_GE_FULL", "PMS_WEG_HV843", "PMS_WEG_PX105", "CPD_CAPITAL", "RECICL_MULT"]

# Data for Comandante (first row)
# Each pair is (obrigatorio_status, validity_years)
# Status: "S" (obrigatorio), "N" (não), "D" (desejável), "I" (indeterminado), "-" (não aplicável)
comandante_data = [
    ("S", 5), ("S", 5), ("S", 5), ("S", 5), ("-", None), ("S", 5), ("S", 5), ("S", 5), ("-", None), ("S", None),
    ("S", 5), ("D", 5), ("S", 5), ("S", None), ("S", None), ("S", 5), ("-", None), ("-", None), ("-", None), ("-", None),
    ("-", None), ("-", None), ("-", None), ("-", None), ("-", None), ("-", None), ("S", None), ("-", None), ("S", None), ("-", None),
    ("-", None), ("-", None), ("-", None), ("-", None), ("S", 1), ("-", None), ("-", None), ("-", None), ("-", None), ("-", None),
    ("-", None), ("-", None), ("-", None), ("-", None), ("S", 5), ("S", None), ("S", 1), ("S", None), ("S", 1), ("S", None),
    ("S", 2), ("-", None), ("-", None), ("-", None), ("-", None), ("S", 5), ("-", None), ("-", None), ("-", None), ("-", None),
    ("-", None), ("-", None), ("N", None), ("N", 5), ("N", 5), ("N", 5), ("N", 5), ("-", None), ("N", 5), ("N", None),
    ("N", None), ("N", 5), ("N", 5), ("N", 5), ("N", 5), ("S", None), ("S", None), ("S", None), ("S", None), ("S", None),
    ("-", None), ("-", None), ("-", None), ("-", None), ("-", None), ("-", None), ("-", None), ("-", None), ("-", None), ("-", None),
    ("-", None), ("-", None), ("S", 1), ("N", 2), (None, None), (None, None), (None, None), (None, None), (None, None), (None, None)
]

def parse_matrix():
    """Parse the CEOP matrix to JSON requirements"""
    requirements = []

    # Comandante requirements
    for i, (status, validity) in enumerate(comandante_data):
        if i >= len(items) or status is None or status == "-":
            continue

        level = "OBRIGATORIO"
        if status == "D":
            level = "DESEJAVEL"
        elif status == "N":
            level = "NAO_OBRIGATORIO"
        elif status == "I":
            level = "INDETERMINADO"

        req = {
            "rankCode": "CMD",
            "trainingItemCode": items[i],
            "level": level,
            "validityYears": validity
        }
        requirements.append(req)

    return requirements

if __name__ == "__main__":
    import os
    reqs = parse_matrix()
    dest = os.path.join(os.path.dirname(__file__), "..", "ceop-requirements.json")
    with open(dest, "w") as f:
        json.dump(reqs, f, indent=2, ensure_ascii=False)
    print(f"Generated {len(reqs)} requirements")
    print(json.dumps(reqs[:5], indent=2, ensure_ascii=False))
