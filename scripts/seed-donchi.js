const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5434/pms_saas?sslmode=disable" });

const TENANT      = "cmodx8zt6007o3g38sevvp09y";
const VESSEL_CODE = "DONCHI";
const VESSEL_NAME = "Embarcación Donchi";
const USER        = "cmodxei4h007p3g38yxsdps3i";

function genId() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }

const ASSETS = [
  // ── EQUIPOS DE NAVEGACION
  { code: "NAV-BATILU",    name: "Baterías de Iluminación EGA",                sfi: "730", crit: "A" },
  { code: "NAV-BATRAD",    name: "Baterías Equipos Navegación y Radio EGA",    sfi: "710", crit: "A" },
  { code: "NAV-LUZEM",     name: "Iluminación de Emergencia",                   sfi: "730", crit: "A" },
  { code: "NAV-TBLLUZ",    name: "Tablero de Luces de Emergencia",              sfi: "730", crit: "A" },
  // ── EQUIPOS DE LUCHA CONTRA INCENDIO
  { code: "INC-BBAPRI",    name: "Bomba de Incendio Principal",                sfi: "861", crit: "A" },
  { code: "INC-BBAEMG",    name: "Bomba de Incendio de Emergencia",            sfi: "861", crit: "A" },
  { code: "INC-MBBPOR",    name: "Motobomba de Incendio EGA Portátil",         sfi: "862", crit: "A" },
  { code: "INC-MBBCUB",    name: "Motobomba de Incendio EGA Portátil Cubierta",sfi: "862", crit: "A" },
  // ── ALARMA DETECTORES DE HUMO
  { code: "ALM-GRPVEN",    name: "Grampas de Cierre de Ventilación",           sfi: "860", crit: "A" },
  { code: "ALM-CRTCMB",    name: "Cortes de Combustible a Distancia",          sfi: "860", crit: "A" },
  // ── EQUIPOS DE LUCHA CONTRA DERRAME
  { code: "DER-VALACH",    name: "Válvulas de Gran Achique",                   sfi: "560", crit: "A" },
  // ── TANQUES COMBUSTIBLE
  { code: "TNQ-CARBON",    name: "Tanques Carboneras G.O.",                    sfi: "500", crit: "A" },
  { code: "TNQ-DIARIO",    name: "Tanque Diario G.O.",                         sfi: "500", crit: "A" },
  { code: "TNQ-SEDGMO",    name: "Tanques Sedimentación G.O.",                 sfi: "500", crit: "A" },
  { code: "TNQ-RESGMO",    name: "Tanque Residuos Purificadora G.O.",          sfi: "500", crit: "A" },
  // ── EQUIPOS MAQUINAS — Seguridades Motor Principal
  { code: "MAQ-MPBRSEG",   name: "Motor Principal – Seguridades Babor",        sfi: "910", crit: "A" },
  { code: "MAQ-MPCTRSEG",  name: "Motor Principal – Seguridades Centro",       sfi: "910", crit: "A" },
  { code: "MAQ-MPERSEG",   name: "Motor Principal – Seguridades Estribor",     sfi: "910", crit: "A" },
  // ── Seguridades Motores Auxiliares
  { code: "MAQ-MA1BRSEG",  name: "Motor Auxiliar 1 – Seguridades Babor",       sfi: "910", crit: "A" },
  { code: "MAQ-MA2ERSEG",  name: "Motor Auxiliar 2 – Seguridades Estribor",    sfi: "910", crit: "A" },
  { code: "MAQ-MA3AUXSEG", name: "Motor Auxiliar 3 – Seguridades",             sfi: "910", crit: "A" },
  { code: "MAQ-ALMSEN",    name: "Alarma de Sentina de Máquinas",              sfi: "910", crit: "A" },
  { code: "MAQ-TORLUM",    name: "Torre de Señales Lumínicas",                 sfi: "810", crit: "A" },
  // ── COMUNICACIONES
  { code: "COM-TELCON",    name: "Teléfono Consola Máquinas / Puente",         sfi: "710", crit: "A" },
  // ── VENTILACIÓN EMERGENCIA
  { code: "VEN-EMGAA",     name: "Parada de Emergencia Ventilador AA Central", sfi: "770", crit: "B" },
  // ── SISTEMA DE GOBIERNO
  { code: "GOB-EMGSYS",    name: "Sistema de Gobierno de Emergencia",          sfi: "660", crit: "A" },
  { code: "GOB-AUXSYS",    name: "Sistema de Gobierno Auxiliar",               sfi: "660", crit: "A" },
];

// frequencyMonths: INT — 7 días→1, 15 días→1, 1 mes→1, 3 meses→3, 6 meses→6, 7 años→84
const PLANS = [
  { ac: "NAV-BATILU",    tc: "NAV-BATILU-T01",    fm: 1,  tt: "INSPECTION",  title: "Inspección Baterías EGA Iluminación",            desc: "Verificar estado de carga y condición general, limpieza de bornes. (Frecuencia real: semanal)" },
  { ac: "NAV-BATILU",    tc: "NAV-BATILU-T02",    fm: 84, tt: "MAINTENANCE", title: "Renovación Grupo Baterías EGA Iluminación",       desc: "Renovar Grupo de Baterías" },
  { ac: "NAV-BATRAD",    tc: "NAV-BATRAD-T01",    fm: 1,  tt: "INSPECTION",  title: "Inspección Baterías Equipos Nav/Radio",           desc: "Verificar estado de carga y condición general, limpieza de bornes. (Frecuencia real: semanal)" },
  { ac: "NAV-BATRAD",    tc: "NAV-BATRAD-T02",    fm: 84, tt: "MAINTENANCE", title: "Renovación Grupo Baterías Equipos Nav/Radio",     desc: "Renovar Grupo de Baterías" },
  { ac: "NAV-LUZEM",     tc: "NAV-LUZEM-T01",     fm: 1,  tt: "INSPECTION",  title: "Verificación Iluminación de Emergencia",          desc: "Verificar estado de artefactos y eficiencia de baterías. Mínimo 6 horas de encendido. (Frecuencia real: semanal)" },
  { ac: "NAV-TBLLUZ",    tc: "NAV-TBLLUZ-T01",    fm: 3,  tt: "INSPECTION",  title: "Control Tablero de Luces de Emergencia",          desc: "Controlar instrumental y ajuste de conexiones" },
  { ac: "INC-BBAPRI",    tc: "INC-BBAPRI-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Bomba de Incendio Principal",              desc: "Prueba de funcionamiento en conjunto con cubierta. (Frecuencia real: cada 15 días)" },
  { ac: "INC-BBAEMG",    tc: "INC-BBAEMG-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Bomba de Incendio de Emergencia",          desc: "Prueba de funcionamiento en conjunto con cubierta. (Frecuencia real: semanal)" },
  { ac: "INC-MBBPOR",    tc: "INC-MBBPOR-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Motobomba de Incendio EGA Portátil",       desc: "Prueba de funcionamiento en conjunto con cubierta" },
  { ac: "INC-MBBCUB",    tc: "INC-MBBCUB-T01",    fm: 6,  tt: "MAINTENANCE", title: "Mantenimiento Motobomba Incendio EGA Cubierta",   desc: "Cambiar aceite, combustible y filtros" },
  { ac: "ALM-GRPVEN",    tc: "ALM-GRPVEN-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Grampas de Cierre de Ventilación",         desc: "Prueba de grampas de ventilación, inspección visual. (Frecuencia real: semanal)" },
  { ac: "ALM-CRTCMB",    tc: "ALM-CRTCMB-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Cortes de Combustible a Distancia",        desc: "Parada de bomba de trasvase" },
  { ac: "DER-VALACH",    tc: "DER-VALACH-T01",    fm: 1,  tt: "INSPECTION",  title: "Verificación Válvulas de Gran Achique",           desc: "Verificar estado de precintos" },
  { ac: "TNQ-CARBON",    tc: "TNQ-CARBON-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Alarma Tanques Carboneras G.O.",           desc: "Prueba de funcionamiento de alarma sonora/visual. (Frecuencia real: semanal)" },
  { ac: "TNQ-DIARIO",    tc: "TNQ-DIARIO-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Alarma Bajo Nivel Tanque Diario G.O.",     desc: "Prueba de funcionamiento de alarma Bajo Nivel, sonora y visual. (Frecuencia real: semanal)" },
  { ac: "TNQ-SEDGMO",    tc: "TNQ-SEDGMO-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Alarma Alto Nivel Tanques Sedimentación",  desc: "Prueba de funcionamiento de alarma Alto Nivel, sonora y visual. (Frecuencia real: semanal)" },
  { ac: "TNQ-RESGMO",    tc: "TNQ-RESGMO-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Alarma Tanque Residuos Purificadora G.O.", desc: "Prueba de funcionamiento de alarma sonora/visual. (Frecuencia real: semanal)" },
  { ac: "MAQ-MPBRSEG",   tc: "MAQ-MPBRSEG-T01",   fm: 1,  tt: "INSPECTION",  title: "Prueba Seguridades Motor Principal Babor",        desc: "Prueba de funcionamiento alarmas led P-Tº — parada EGA" },
  { ac: "MAQ-MPCTRSEG",  tc: "MAQ-MPCTRSEG-T01",  fm: 1,  tt: "INSPECTION",  title: "Prueba Seguridades Motor Principal Centro",       desc: "Prueba de funcionamiento alarmas led P-Tº — parada EGA" },
  { ac: "MAQ-MPERSEG",   tc: "MAQ-MPERSEG-T01",   fm: 1,  tt: "INSPECTION",  title: "Prueba Seguridades Motor Principal Estribor",     desc: "Prueba de funcionamiento alarmas led P-Tº — parada EGA" },
  { ac: "MAQ-MA1BRSEG",  tc: "MAQ-MA1BRSEG-T01",  fm: 1,  tt: "INSPECTION",  title: "Prueba Seguridades Motor Auxiliar 1 Babor",       desc: "Prueba de función alarmas Vigia P.Tº Parada EGA" },
  { ac: "MAQ-MA2ERSEG",  tc: "MAQ-MA2ERSEG-T01",  fm: 1,  tt: "INSPECTION",  title: "Prueba Seguridades Motor Auxiliar 2 Estribor",    desc: "Prueba de función alarmas Vigia P.Tº Parada EGA" },
  { ac: "MAQ-MA3AUXSEG", tc: "MAQ-MA3AUXSEG-T01", fm: 1,  tt: "INSPECTION",  title: "Prueba Seguridades Motor Auxiliar 3",             desc: "Prueba de función alarmas Vigia P.Tº Parada EGA" },
  { ac: "MAQ-ALMSEN",    tc: "MAQ-ALMSEN-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Alarma de Sentina de Máquinas",            desc: "Prueba de función alarma Estribor, Babor y Timón. (Frecuencia real: semanal)" },
  { ac: "MAQ-TORLUM",    tc: "MAQ-TORLUM-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Torre de Señales Lumínicas",               desc: "Prueba de funcionamiento de Luces, Llamada Tel., Alarma Gral. y Alarmas de Máquinas. (Frecuencia real: semanal)" },
  { ac: "COM-TELCON",    tc: "COM-TELCON-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Teléfono Consola Máquinas/Puente",         desc: "Prueba de funcionamiento entre Consola Máquinas/Puente. (Frecuencia real: semanal)" },
  { ac: "VEN-EMGAA",     tc: "VEN-EMGAA-T01",     fm: 1,  tt: "INSPECTION",  title: "Prueba Parada Emergencia Ventilador AA Central",  desc: "Parada de emergencia ventiladores AA Central. (Frecuencia real: cada 15 días)" },
  { ac: "GOB-AUXSYS",    tc: "GOB-AUXSYS-T01",    fm: 1,  tt: "INSPECTION",  title: "Prueba Sistema de Gobierno Auxiliar",             desc: "Prueba de funcionamiento — control visual de partes" },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Vessel
    const vid = genId();
    await client.query(`
      INSERT INTO "Vessel" (id, "tenantId", code, name, status, "createdAt", "updatedAt", "createdByUserId", "updatedByUserId")
      VALUES ($1,$2,$3,$4,'ACTIVE',now(),now(),$5,$5)
      ON CONFLICT ("tenantId", code) DO NOTHING
    `, [vid, TENANT, VESSEL_CODE, VESSEL_NAME, USER]);

    const vr = await client.query(`SELECT id FROM "Vessel" WHERE "tenantId"=$1 AND code=$2`, [TENANT, VESSEL_CODE]);
    const vesselDbId = vr.rows[0].id;
    console.log("Vessel:", vesselDbId);

    // 2. Assets
    const assetIdMap = {};
    for (const a of ASSETS) {
      const aid = genId();
      await client.query(`
        INSERT INTO "Asset" (id, "tenantId", "vesselCode", "assetCode", name, "sfiCode", criticality, status,
          "createdAt", "updatedAt", "createdByUserId", "updatedByUserId")
        VALUES ($1,$2,$3,$4,$5,$6,$7,'OPERATIONAL',now(),now(),$8,$8)
        ON CONFLICT ("tenantId", "vesselCode", "assetCode") DO NOTHING
      `, [aid, TENANT, VESSEL_CODE, a.code, a.name, a.sfi, a.crit, USER]);

      const ar = await client.query(`SELECT id FROM "Asset" WHERE "tenantId"=$1 AND "vesselCode"=$2 AND "assetCode"=$3`, [TENANT, VESSEL_CODE, a.code]);
      assetIdMap[a.code] = ar.rows[0].id;
    }
    console.log("Assets:", Object.keys(assetIdMap).length);

    // 3. Maintenance Plans
    let ok = 0;
    for (const p of PLANS) {
      const assetId = assetIdMap[p.ac];
      if (!assetId) { console.warn("Asset not found:", p.ac); continue; }
      const pid = genId();
      await client.query(`
        INSERT INTO "MaintenancePlan"
          (id, "tenantId", "vesselCode", "assetId", "taskCode", title, description,
           "triggerType", "frequencyMonths", "taskType", status, "executionStatus",
           "createdAt", "updatedAt", "createdByUserId", "updatedByUserId")
        VALUES ($1,$2,$3,$4,$5,$6,$7,
          CAST('MONTHS' AS "MaintenancePlanTrigger"), $8,
          CAST($9 AS "TaskType"),
          CAST('ACTIVE' AS "MaintenancePlanStatus"),
          CAST('FUTURE' AS "ExecutionStatus"),
          now(),now(),$10,$10)
        ON CONFLICT ("tenantId", "vesselCode", "taskCode") DO NOTHING
      `, [pid, TENANT, VESSEL_CODE, assetId, p.tc, p.title, p.desc, p.fm, p.tt, USER]);
      ok++;
    }
    console.log("Planes:", ok);

    await client.query("COMMIT");
    console.log("DONE");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ERROR:", e.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

run();
