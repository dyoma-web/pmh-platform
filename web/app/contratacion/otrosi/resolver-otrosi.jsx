"use client";
import { useState } from "react";

export default function ResolverOtrosi({ id, actorId }) {
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(accion) {
    if (!actorId) { setMsj("Elige arriba quién resuelve."); return; }
    let nota;
    if (accion === "rechazar") {
      nota = window.prompt("Nota de rechazo (obligatoria):");
      if (!nota?.trim()) return;
    }
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/otrosi", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, otrosi_id: id, actor_id: Number(actorId), nota }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else { setMsj(j.error || "Error inesperado."); setOcupado(false); }
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button className="btn" style={{ padding: "4px 12px", fontSize: 12 }}
        disabled={ocupado} onClick={() => enviar("aprobar")}>Aprobar y aplicar</button>
      <button className="btn sec" style={{ padding: "4px 12px", fontSize: 12 }}
        disabled={ocupado} onClick={() => enviar("rechazar")}>Rechazar</button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 11, maxWidth: 200 }}>{msj}</span>}
    </div>
  );
}
