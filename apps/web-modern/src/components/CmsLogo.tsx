import React from "react";

/**
 * Logo del CMS: imagen oficial (mitad engranaje + mitad circuito).
 *
 * Archivo: /logo-white.png (en public/)
 * Reusable en mobile, login, sidebar, etc.
 *
 * Pasale className para ajustar el tamaño con Tailwind (ej. "w-6 h-6").
 */
export const CmsLogo: React.FC<{ className?: string; title?: string }> = ({
  className = "w-5 h-5",
  title = "CMS",
}) => (
  <img
    src="/logo-white.png"
    alt={title}
    className={`object-contain ${className}`}
    draggable={false}
  />
);
