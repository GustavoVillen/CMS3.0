-- Seed 13 tripulantes capitalmaritima / ACEDEF
-- Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ
-- Status: SIGNED_OFF (desembarcaron 2025-09-03 · histórico)
-- Mapping BR rank → CrewRank enum:
--   CMT=CAPTAIN  IMT=CHIEF_OFFICER  OQN=SECOND/THIRD_OFFICER  CFM=CHIEF_ENGINEER
--   SCM=SECOND_ENGINEER  OQM=THIRD_ENGINEER  ELT=ELECTRICIAN
--   MNC=AB_SEAMAN  MNM=OILER

BEGIN;

DO $$
DECLARE
  v_tid TEXT := 'cmorbemkq003bful4e5w6zkqc';
  v_uid TEXT := 'cmorbfi7m003cful4xzf6e3af';
  v_now TIMESTAMP := NOW();
BEGIN

INSERT INTO "Crew"
  (id, "tenantId", "vesselCode", "crewCode", "firstName", "lastName", rank, nationality,
   "dateOfBirth", "passportNumber", "signOnDate", "signOffDate", status, notes,
   "createdAt", "createdByUserId", "updatedAt", "updatedByUserId", "reopenCount")
VALUES
  ('crw_cap_001', v_tid, 'ACEDEF', 'CR-001', 'Gilson Petra',  'de Almeida Junior',   'CAPTAIN',         'Brasileira', '1982-10-29', '381P2002008550', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_002', v_tid, 'ACEDEF', 'CR-002', 'João',           'Correia de Oliveira', 'CHIEF_OFFICER',   'Brasileira', '1984-02-03', '802P2009000649', '2025-07-09', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_003', v_tid, 'ACEDEF', 'CR-003', 'Ehrlich',        'dos Santos Olivera',  'SECOND_OFFICER',  'Brasileira', '1976-06-08', '261P2001027735', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: OQN', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_004', v_tid, 'ACEDEF', 'CR-004', 'Alexandre',      'Monteiro dos Santos', 'THIRD_OFFICER',   'Brasileira', '1979-02-20', '802P2009001378', '2025-08-18', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: OQN', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_005', v_tid, 'ACEDEF', 'CR-005', 'Jose Glayshonn', 'Bezerra',             'CHIEF_ENGINEER',  'Brasileira', '1966-07-10', '021P2001152586', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_006', v_tid, 'ACEDEF', 'CR-006', 'Marcos Thadeu',  'Nazareth Ramos',      'SECOND_ENGINEER', 'Brasileira', '1957-03-19', '801P2010001420', '2025-08-18', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: SCM', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_007', v_tid, 'ACEDEF', 'CR-007', 'Valdeir',        'de Souza Aguiar',     'THIRD_ENGINEER',  'Brasileira', '1994-03-04', '802P2016000223', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: OQM', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_008', v_tid, 'ACEDEF', 'CR-008', 'Jorge Leonard',  'Kaczmarkiewicz',      'ELECTRICIAN',     'Brasileira', '1953-02-09', '381P2001365999', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_009', v_tid, 'ACEDEF', 'CR-009', 'Jonathas',       'Trajano de Moura',    'AB_SEAMAN',       'Brasileira', '1981-05-01', '201P2002000571', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: MNC', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_010', v_tid, 'ACEDEF', 'CR-010', 'Erivaldo',       'do Santos Silva',     'AB_SEAMAN',       'Brasileira', '1979-10-09', '161P2000400762', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: MNC', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_011', v_tid, 'ACEDEF', 'CR-011', 'Victor',         'Viana Santos',        'AB_SEAMAN',       'Brasileira', '1986-11-14', '261P2010001680', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: MNC', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_012', v_tid, 'ACEDEF', 'CR-012', 'Luis Fernando',  'Jacinto',             'AB_SEAMAN',       'Brasileira', '1981-08-24', '443P2015001006', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: MNC', v_now, v_uid, v_now, v_uid, 0),
  ('crw_cap_013', v_tid, 'ACEDEF', 'CR-013', 'Anderson',       'Procópio da Silva',   'OILER',           'Brasileira', '1979-10-09', '443P2007002878', '2025-08-06', '2025-09-03', 'SIGNED_OFF', 'Bandera: CYPRUS · Embarque/desembarque: Rio de Janeiro-RJ · BR rank: MNM', v_now, v_uid, v_now, v_uid, 0);

-- PASSPORT certifications (con vencimiento)
INSERT INTO "CrewCertification"
  (id, "tenantId", "crewId", type, "certificateNumber", "expiryDate", status,
   "createdAt", "createdByUserId", "updatedAt", "updatedByUserId")
VALUES
  ('crt_cap_pp01', v_tid, 'crw_cap_001', 'PASSPORT', '381P2002008550', '2027-07-25', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp02', v_tid, 'crw_cap_002', 'PASSPORT', '802P2009000649', '2028-11-23', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp03', v_tid, 'crw_cap_003', 'PASSPORT', '261P2001027735', '2028-03-16', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp04', v_tid, 'crw_cap_004', 'PASSPORT', '802P2009001378', '2027-02-09', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp05', v_tid, 'crw_cap_005', 'PASSPORT', '021P2001152586', '2028-08-17', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp06', v_tid, 'crw_cap_006', 'PASSPORT', '801P2010001420', '2026-12-23', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp07', v_tid, 'crw_cap_007', 'PASSPORT', '802P2016000223', '2029-07-15', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp08', v_tid, 'crw_cap_008', 'PASSPORT', '381P2001365999', '2030-08-07', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp09', v_tid, 'crw_cap_009', 'PASSPORT', '201P2002000571', '2029-12-19', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp10', v_tid, 'crw_cap_010', 'PASSPORT', '161P2000400762', '2026-09-15', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp11', v_tid, 'crw_cap_011', 'PASSPORT', '261P2010001680', '2026-08-26', 'VALID',   v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp12', v_tid, 'crw_cap_012', 'PASSPORT', '443P2015001006', '2026-01-22', 'EXPIRED', v_now, v_uid, v_now, v_uid),
  ('crt_cap_pp13', v_tid, 'crw_cap_013', 'PASSPORT', '443P2007002878', '2028-07-20', 'VALID',   v_now, v_uid, v_now, v_uid);

-- Vacuna fiebre amarilla (type=OTHER · sin vencimiento por OMS 2016)
INSERT INTO "CrewCertification"
  (id, "tenantId", "crewId", type, "issuingAuthority", "issuedDate", status, notes,
   "createdAt", "createdByUserId", "updatedAt", "updatedByUserId")
VALUES
  ('crt_cap_yf01', v_tid, 'crw_cap_001', 'OTHER', 'Ministério da Saúde - Brasil', '2014-06-05', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf02', v_tid, 'crw_cap_002', 'OTHER', 'Ministério da Saúde - Brasil', '2012-03-17', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf03', v_tid, 'crw_cap_003', 'OTHER', 'Ministério da Saúde - Brasil', '2019-03-30', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf04', v_tid, 'crw_cap_004', 'OTHER', 'Ministério da Saúde - Brasil', '2008-01-21', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf05', v_tid, 'crw_cap_005', 'OTHER', 'Ministério da Saúde - Brasil', '2004-05-04', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf06', v_tid, 'crw_cap_006', 'OTHER', 'Ministério da Saúde - Brasil', '2015-08-16', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf07', v_tid, 'crw_cap_007', 'OTHER', 'Ministério da Saúde - Brasil', '2012-10-13', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf08', v_tid, 'crw_cap_008', 'OTHER', 'Ministério da Saúde - Brasil', '2001-10-21', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf09', v_tid, 'crw_cap_009', 'OTHER', 'Ministério da Saúde - Brasil', '2014-12-15', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf10', v_tid, 'crw_cap_010', 'OTHER', 'Ministério da Saúde - Brasil', '2013-11-30', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf11', v_tid, 'crw_cap_011', 'OTHER', 'Ministério da Saúde - Brasil', '2022-05-26', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf12', v_tid, 'crw_cap_012', 'OTHER', 'Ministério da Saúde - Brasil', '2015-11-26', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid),
  ('crt_cap_yf13', v_tid, 'crw_cap_013', 'OTHER', 'Ministério da Saúde - Brasil', '2008-01-10', 'VALID', 'Vacina febre amarela / Yellow fever vaccination', v_now, v_uid, v_now, v_uid);

END $$;

COMMIT;

-- Verificación
SELECT c."crewCode", c."firstName", c."lastName", c.rank, c.status,
       (SELECT COUNT(*) FROM "CrewCertification" cc WHERE cc."crewId"=c.id) as certs
FROM "Crew" c
WHERE c."tenantId"='cmorbemkq003bful4e5w6zkqc'
ORDER BY c."crewCode";
