// Campo de texto que se abre estirado hasta la última línea de su contenido.
//
// El problema que resuelve: un `<textarea>` tiene alto fijo (`rows`), así que
// un texto largo — criterios de aceptación, descripción de una falla, detalle
// de un plan — se abría cortado detrás de un scroll interno y había que
// arrastrar cada campo para leerlo. Acá el alto se calcula del contenido al
// montar y cada vez que el texto cambia.
//
// Se sigue pudiendo agrandar o achicar a mano (`resize-y`); ese alto manual
// vale hasta que cambie el texto, momento en que se vuelve a ajustar solo.
// `rows` sigue siendo el piso: un campo vacío no queda como una raya.
//
// Si el campo tiene un techo por CSS (`max-h-*`), el navegador lo respeta y a
// partir de ahí vuelve a aparecer el scroll — que es lo que se quiere en cajas
// de texto muy largas (prompts, documentos).

import React from "react";

/** Ajusta el alto de un textarea a su contenido. Devuelve el ref a montarle. */
export function useAutoGrowTextArea(value: unknown) {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  const fit = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Campo todavía sin dibujar (modal recién montado, pestaña oculta):
    // scrollHeight da 0 y lo dejaría aplastado. Se reintenta al verse.
    if (el.offsetParent === null && el.scrollHeight === 0) return;
    el.style.height = "auto";
    // scrollHeight no cuenta los bordes: sin esto el texto queda 1-2px corto y
    // el navegador dibuja igual la barra de scroll.
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + borders}px`;
  }, []);

  React.useLayoutEffect(fit, [fit, value]);

  return { ref, fit };
}

/** Reemplazo directo de `<textarea>`: mismas props, con alto automático. */
export const AutoTextArea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<"textarea">>(
  function AutoTextArea({ onInput, ...props }, forwardedRef) {
    const { ref, fit } = useAutoGrowTextArea(props.value);
    return (
      <textarea
        {...props}
        ref={node => {
          ref.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        // También para los campos no controlados, que no avisan por `value`.
        onInput={e => { fit(); onInput?.(e); }}
      />
    );
  },
);
