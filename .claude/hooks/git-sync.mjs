// Mantiene C:\CMS3.0 al día con GitHub para trabajar el mismo repo desde dos PCs.
//   start: al abrir la sesión baja lo nuevo de la otra PC y sube lo que haya quedado pendiente.
//   stop:  al terminar cada respuesta sube los commits que todavía no estén en GitHub.
// Nunca mezcla ramas separadas, ni reescribe, ni descarta nada: en ese caso sólo avisa.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

function git(...args) {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', env, timeout: 45_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out: out.trim() };
  } catch (err) {
    return { ok: false, out: String(err.stderr || err.message).trim().split('\n').slice(-2).join(' ') };
  }
}

function aheadBehind() {
  const r = git('rev-list', '--left-right', '--count', 'HEAD...@{u}');
  if (!r.ok) return null;
  const [ahead, behind] = r.out.split(/\s+/).map(Number);
  return { ahead, behind };
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function start() {
  const head = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (!head.ok) return `No se pudo leer el repo: ${head.out}`;
  const branch = head.out;
  if (branch === 'HEAD') return `No hay una rama activa (HEAD suelto): no se sincronizó.`;
  if (!git('rev-parse', '--abbrev-ref', '@{u}').ok) return `La rama ${branch} no está en GitHub todavía: no se sincronizó.`;

  if (!git('fetch', '--quiet', '--prune', 'origin').ok) {
    return `Sin conexión con GitHub: no se pudo comprobar si la otra PC subió cambios a ${branch}.`;
  }

  const c = aheadBehind();
  if (!c) return `No se pudo comparar ${branch} con GitHub.`;
  const lines = [];
  if (c.behind > 0 && c.ahead === 0) {
    const r = git('merge', '--ff-only', '--quiet', '@{u}');
    lines.push(r.ok
      ? `Se bajaron ${c.behind} commits de GitHub (de la otra PC) a ${branch}.`
      : `GitHub tiene ${c.behind} commits nuevos en ${branch} que no se pudieron bajar porque chocan con cambios locales sin commitear. Avisarle a Gustavo antes de tocar esos archivos. (${r.out})`);
  } else if (c.ahead > 0 && c.behind === 0) {
    const r = git('push', '--quiet');
    lines.push(r.ok
      ? `Se subieron a GitHub ${c.ahead} commits de ${branch} que habían quedado pendientes.`
      : `Hay ${c.ahead} commits de ${branch} sin subir y el push falló. (${r.out})`);
  } else if (c.ahead > 0 && c.behind > 0) {
    lines.push(`La rama ${branch} se separó de GitHub: ${c.ahead} commits sólo en esta PC y ${c.behind} sólo en GitHub. No se tocó nada. Avisarle a Gustavo antes de seguir y no forzar el push.`);
  } else {
    lines.push(`${branch} está al día con GitHub.`);
  }

  const dirty = git('status', '--porcelain', '--untracked-files=no').out;
  if (dirty) lines.push(`Hay ${dirty.split('\n').length} archivos modificados sin commitear (pueden ser de otra sesión).`);
  return lines.join(' ');
}

function stop() {
  const c = aheadBehind();
  if (!c || c.ahead === 0) return;

  const r = git('push', '--quiet');
  if (r.ok) {
    console.log(JSON.stringify({ systemMessage: `Subidos a GitHub ${c.ahead} commits.` }));
    return;
  }
  if (readStdin().stop_hook_active) return;
  console.log(JSON.stringify({
    decision: 'block',
    reason: `No se pudieron subir ${c.ahead} commits a GitHub (${r.out}). Lo más probable es que la otra PC haya subido cambios. ` +
      'Revisar con git status y git log, no forzar el push y explicárselo a Gustavo en palabras simples.',
  }));
}

if (mode === 'start') console.log(`[Sincronización con GitHub] ${start()}`);
else if (mode === 'stop') stop();
