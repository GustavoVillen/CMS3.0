# GPMS — Reglas del repositorio

## UI / UX

### Tablas y listas: click en fila abre edición
Hacer click en una fila de tabla (`DataTable`) o card de lista abre el modal/drawer de edición directamente.
**Nunca** agregar un botón "Editar" (ni ícono lápiz) dentro de la fila o card.

Otras acciones secundarias (ej. "Ver detalle", "Eliminar") pueden ir como botones en la fila, pero **no "Editar"**.

```tsx
// ✅ correcto
<tr onClick={() => setEditing(row)} className="cursor-pointer hover:bg-white/5">

// ❌ incorrecto
<button onClick={() => setEditing(row)}><Pencil /> Editar</button>
```
