/**
 * Carga del .env — import de SOLO EFECTO, tiene que ir PRIMERO en server.ts.
 *
 * Los imports de un módulo se evalúan antes que el cuerpo del módulo que los
 * importa. Cuando `loadDotEnvFile()` se llamaba en el cuerpo de server.ts, todo
 * el árbol de imports (routers → servicios de IA) ya se había inicializado con
 * `process.env` vacío. Los servicios que congelan configuración al cargarse
 * —`const MODEL = AI_MODEL.fast`— se quedaban con el default de Anthropic
 * aunque el .env dijera AI_PROVIDER=gemini, y después el cliente (que sí se
 * crea en cada request, ya con el .env cargado) le mandaba a Google un id de
 * modelo de Claude → 404 "model not found".
 *
 * Importando este módulo primero, el .env está disponible para cualquier
 * inicialización a nivel de módulo.
 */
import { loadDotEnvFile } from "./load-dotenv";

loadDotEnvFile();
