"use client";
import { useState } from "react";

export default function SubirPortal({ token, pago }) {
  const [estado, setEstado] = useState({ cuenta: !!pago.invoice_url, soporte: !!pago.legal_support_url });
  const [msj, setMsj] = useState(null);
  const [subiendo, setSubiendo] = useState(null);

  async function subir(tipo, file) {
    if (!file) return;
    setSubiendo(tipo); setMsj(null);
    const fd = new FormData();
    fd.append("token", token);
    fd.append("pago_id", pago.id);
    fd.append("tipo", tipo);
    fd.append("file", file);
    const r = await fetch("/api/portal", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setSubiendo(null);
    if (r.ok) setEstado((e) => ({ ...e, [tipo]: true }));
    else setMsj(j.error || "No se pudo subir.");
  }

  const Boton = ({ tipo, etiqueta }) => (
    <label className={"btn " + (estado[tipo] ? "sec" : "")}
      style={{ padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
      {subiendo === tipo ? "subiendo…" : estado[tipo] ? `${etiqueta} ✓ (reemplazar)` : `Subir ${etiqueta}`}
      <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => subir(tipo, e.target.files?.[0])} disabled={!!subiendo} />
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Boton tipo="cuenta" etiqueta="cuenta de cobro" />
        <Boton tipo="soporte" etiqueta="seguridad social" />
      </div>
      {estado.cuenta && estado.soporte && (
        <span className="sev correcto">documentos completos — administración validará</span>
      )}
      {msj && <span style={{ color: "var(--critico)", fontSize: 12, maxWidth: 260 }}>{msj}</span>}
    </div>
  );
}
