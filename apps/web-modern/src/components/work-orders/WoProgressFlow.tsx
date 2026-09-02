// "Nuevo registro de Avance de OT" (acceso del Dashboard).
//
// Dos pasos: elegir una Orden de Trabajo abierta y asentar sobre ella el avance
// del trabajo. Es la misma hoja de avance que vive dentro del formulario de la
// OT (ProgressNoteSheet: texto, foto, video, audio o documento): acá sólo se le
// cambia la puerta de entrada, para que la tripulación registre lo que hizo sin
// recorrer el formulario entero.
//
// Gemelo de SsProgressFlow (avance de SS) y de SpareConsumptionFlow (consumo de
// repuestos): mismo picker de OT abiertas, mismo cierre al guardar.

import React from "react";
import { useT } from "../../lib/i18n";
import { OpenWorkOrdersPicker } from "../service-requests/OpenWorkOrdersPicker";
import { ProgressNoteSheet } from "../../mobile/ProgressNoteSheet";

export function WoProgressFlow({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [wo, setWo] = React.useState<{ id: string; workOrderCode: string } | null>(null);
  // La hoja avisa `onSaved` y enseguida `onClose`. Con el avance ya guardado el
  // flujo entero se cierra (igual que el consumo de repuestos); si se salió sin
  // guardar, se vuelve a la lista para elegir otra orden.
  const guardado = React.useRef(false);

  if (!wo) {
    return (
      <OpenWorkOrdersPicker
        onClose={onClose}
        onPick={(picked) => { guardado.current = false; setWo(picked); }}
        title={t("dashboard.woProgress.pickTitle")}
        subtitle={t("dashboard.woProgress.pickSubtitle")}
      />
    );
  }

  return (
    <ProgressNoteSheet
      workOrderId={wo.id}
      onSaved={() => { guardado.current = true; }}
      onClose={() => { if (guardado.current) onClose(); else setWo(null); }}
    />
  );
}
