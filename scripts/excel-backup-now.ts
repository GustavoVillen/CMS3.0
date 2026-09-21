// Respaldo semanal en Excel, a mano (el automático corre solo el domingo; ver
// apps/api/src/tenant/excel/weekly-excel-backup-service.ts).
//
//   pnpm exec tsx scripts/excel-backup-now.ts <empresa>                 → sube al Drive si falta la semana
//   pnpm exec tsx scripts/excel-backup-now.ts <empresa> --force         → la vuelve a subir igual
//   pnpm exec tsx scripts/excel-backup-now.ts <empresa> --local <dir>   → sólo genera los archivos en <dir>, no toca el Drive
//
// Sólo lee la base; lo único que escribe es en el Drive de la empresa (o en <dir>).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find(a => !a.startsWith("--"));
  const force = args.includes("--force");
  const localIdx = args.indexOf("--local");
  const localDir = localIdx >= 0 ? resolve(args[localIdx + 1] ?? "") : null;
  if (!slug || (localIdx >= 0 && !args[localIdx + 1])) {
    process.stderr.write("Uso: tsx scripts/excel-backup-now.ts <empresa> [--force] [--local <carpeta>]\n");
    process.exit(2);
  }

  // Igual que la API: corre parada en apps/api (uploads, logo del frontend).
  process.chdir(join(__dirname, "..", "apps", "api"));
  await import("../apps/api/src/config/bootstrap-env");
  const { getPrismaClient } = await import("../apps/api/src/platform/data/prisma-client");
  const svc = await import("../apps/api/src/tenant/excel/weekly-excel-backup-service");

  const tenant = await getPrismaClient()!.tenant.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!tenant) throw new Error(`No existe la empresa "${slug}".`);

  if (localDir) {
    const files = await svc.buildTenantExcelFiles(tenant.id, tenant.slug);
    for (const f of files) {
      const dir = f.folder ? join(localDir, f.folder) : localDir;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, f.name), f.content);
      process.stdout.write(`${f.folder ? `${f.folder}/` : ""}${f.name}  ${f.rows} filas  ${Math.round(f.content.length / 1024)} KB\n`);
    }
    process.exit(0);
  }

  const started = Date.now();
  const result = await svc.runTenantExcelBackup(tenant.id, tenant.slug, { force });
  process.stdout.write(`${JSON.stringify(result)} en ${Math.round((Date.now() - started) / 1000)}s\n`);
  process.exit(0);
}

main().catch(e => { process.stderr.write(String(e?.stack ?? e) + "\n"); process.exit(1); });
