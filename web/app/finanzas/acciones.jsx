"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

export function BotonSellar({ mes }) {
  const actorId = useSearchParams().get("actor") || "";
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  async function sellar() {
    if (!actorId) { setMsj("Elige arriba quién sella."); return; }
    if (!window.confirm(`Sellar ${mes} lo hace inmutable. ¿Confirmas?`)) return;
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/finanzas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "sellar", mes, actor_id: Number(actorId) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else { setMsj(j.error || "Error."); setOcupado(false); }
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button className="btn" style={{ padding: "4px 12px", fontSize: 12 }}
        disabled={ocupado} onClick={sellar}>Sellar periodo</button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 11 }}>{msj}</span>}
    </span>
  );
}

export function BotonConciliar({ glId, pagoId, confianza }) {
  const actorId = useSearchParams().get("actor") || "";
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  async function conciliar() {
    if (!actorId) { setMsj("Elige arriba quién concilia."); return; }
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/finanzas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "conciliar", gl_id: glId, pago_id: pagoId,
        confianza, actor_id: Number(actorId) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else { setMsj(j.error || "Error."); setOcupado(false); }
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button className="btn" style={{ padding: "4px 12px", fontSize: 12 }}
        disabled={ocupado} onClick={conciliar}>Confirmar pareja</button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 11, maxWidth: 200 }}>{msj}</span>}
    </span>
  );
}
