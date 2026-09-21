// Certificado de PRUEBA para el sello digital de los PDF (ver src/common/pdf-seal.ts).
//
// Autofirmado: sirve para ver el sello funcionando (panel de firmas en Adobe,
// deteccion de cambios), pero Adobe lo muestra como "identidad no verificada".
// En produccion se reemplaza por el certificado real de la empresa, emitido por
// un prestador habilitado, con el mismo nombre de archivo.
//
//   node scripts/generate-pdf-seal-test-cert.mjs <tenantSlug> <carpeta> "<Nombre de la empresa>"
//
// Deja <carpeta>/<tenantSlug>.p12 y <carpeta>/<tenantSlug>.pass.

import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// node-forge llega como dependencia de @signpdf/signer-p12; se resuelve desde ahi.
const require = createRequire(import.meta.url);
const forge = createRequire(require.resolve("@signpdf/signer-p12"))("node-forge");

const [tenantSlug, outDir, orgName] = process.argv.slice(2);
if (!tenantSlug || !outDir || !orgName) {
  console.error('Uso: node scripts/generate-pdf-seal-test-cert.mjs <tenantSlug> <carpeta> "<Nombre de la empresa>"');
  process.exit(1);
}

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01" + randomBytes(8).toString("hex");
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);
const attrs = [
  { name: "commonName", value: `${orgName} (PRUEBA)` },
  { name: "organizationName", value: orgName },
  { name: "countryName", value: "PY" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([
  { name: "basicConstraints", cA: false },
  { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

const passphrase = randomBytes(12).toString("base64url");
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: "3des" });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${tenantSlug}.p12`), Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"));
writeFileSync(join(outDir, `${tenantSlug}.pass`), passphrase + "\n", { mode: 0o600 });
console.log(`OK: ${join(outDir, `${tenantSlug}.p12`)} (valido hasta ${cert.validity.notAfter.toISOString().slice(0, 10)})`);
