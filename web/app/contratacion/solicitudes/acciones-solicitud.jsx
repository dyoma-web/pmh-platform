"use client";
import { useState } from "react";

export default function AccionesSolicitud({ code, actorId }) {
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(accion) {
    if (!actorId) { setMsj("Elige arriba quién actúa."); return; }
    let motivo;
    if (accion === "cancelar") {
      motivo = window.prompt("Motivo de la cancelación (obligatorio):");
      if (!motivo?.trim()) return;
    }
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/solicitudes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, solicitud: code, actor_id: Number(actorId), motivo }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else { setMsj(j.error || "Error inesperado."); setOcupado(false); }
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button className="btn" style={{ padding: "5px 12px", fontSize: 12 }}
        disabled={ocupado} onClick={() => enviar("procesar")}>Procesar → contrato</button>
      <button className="btn sec" style={{ padding: "5px 12px", fontSize: 12 }}
        disabled={ocupado} onClick={() => enviar("cancelar")}>Cancelar</button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 11, maxWidth: 220 }}>{msj}</span>}
    </div>
  );
}
