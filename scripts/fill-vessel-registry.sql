-- Completa bandera, puerto de registro, manager y sociedad de clase de la flota
-- Mercurio. La sociedad de clase sale del certificado de clasificacion vigente
-- de cada embarcacion. Se puede correr mas de una vez.
UPDATE "Vessel" v SET
  flag = 'Paraguay',
  "portOfRegistry" = 'Asunción',
  manager = 'Mercurio Naviera',
  "classSociety" = COALESCE((
    SELECT c."issuingAuthority" FROM "Certificate" c
    WHERE c."tenantId" = v."tenantId" AND c."vesselCode" = v.code AND c."deletedAt" IS NULL
      AND (c.name ILIKE '%clasif%' OR c.name ILIKE '%certificado de clase%')
    ORDER BY c."issueDate" DESC LIMIT 1
  ), v."classSociety"),
  "updatedAt" = now()
FROM "Tenant" t
WHERE t.id = v."tenantId" AND t.slug IN ('mercurio', 'demo') AND v."deletedAt" IS NULL;
SELECT t.slug, v.code, v.flag, v."portOfRegistry", v."classSociety", v.manager
FROM "Vessel" v JOIN "Tenant" t ON t.id = v."tenantId"
WHERE t.slug IN ('mercurio', 'demo') AND v."deletedAt" IS NULL ORDER BY 1, 2;
