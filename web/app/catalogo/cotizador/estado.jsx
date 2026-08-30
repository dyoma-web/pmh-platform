"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function EstadoCotizacion({ code, estado }) {
  const actorId = useSearchParams().get("actor") || "";
  const [msj, setMsj] = useState(null);
  async function marcar(nuevo) {
    let actor = actorId;
    if (!actor) actor = window.prompt("ID de quien actualiza (ver selector en otras pantallas):") || "";
    if (!actor) return;
    const r = await fetch("/api/potenciacion", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "cotizacion_estado", code, estado: nuevo, actor_id: Number(actor) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else setMsj(j.error || "Error.");
  }
  if (estado === "won" || estado === "lost") return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {estado === "draft" && (
        <button className="btn sec" style={{ padding: "3px 10px", fontSize: 11 }}
          onClick={() => marcar("sent")}>Enviada</button>
      )}
      <button className="btn sec" style={{ padding: "3px 10px", fontSize: 11 }}
        onClick={() => marcar("won")}>Ganada</button>
      <button className="btn sec" style={{ padding: "3px 10px", fontSize: 11 }}
        onClick={() => marcar("lost")}>Perdida</button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 10 }}>{msj}</span>}
    </span>
  );
}
