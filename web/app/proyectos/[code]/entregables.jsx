"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export default function Entregables({ projectCode, entregables, usuarios, esAdminLista }) {
  const actorId = useSearchParams().get("actor") || "";
  const [nuevo, setNuevo] = useState({ description: "", due_date: "", planned_value_cop: "", responsible_id: "" });
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function api(payload) {
    const r = await fetch("/api/potenciacion", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, actor_id: Number(actorId) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Error inesperado.");
    return j;
  }

  async function crear() {
    if (!actorId) { setMsj("Elige arriba quién registra."); return; }
    setOcupado(true); setMsj(null);
    try {
      await api({ accion: "entregable_crear", project_code: projectCode, ...nuevo,
        planned_value_cop: Number(nuevo.planned_value_cop),
        responsible_id: nuevo.responsible_id ? Number(nuevo.responsible_id) : undefined });
      window.location.reload();
    } catch (e) { setMsj(e.message); setOcupado(false); }
  }

  async function avance(id, pct) {
    if (!actorId) { setMsj("Elige arriba quién registra."); return; }
    try {
      await api({ accion: "entregable_avance", entregable_id: id, progress_pct: pct });
      window.location.reload();
    } catch (e) { setMsj(e.message); }
  }

  return (
    <div>
      {entregables.map((e) => (
        <div className="fila instr-row" key={e.id}
          style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 0",
            borderBottom: "1px solid var(--filete)", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ flex: 1 }}>
            {e.description}
            <span className="notaf" style={{ marginLeft: 8 }}>
              {e.responsable ?? "sin responsable"} · compromiso {e.due}
            </span>
          </span>
          <span className="mono" style={{ fontFamily: "var(--fx-mono)", fontSize: 11 }}>
            $ {nf.format(e.planned_value_cop)}
          </span>
          <input type="range" min="0" max="100" step="5" defaultValue={Number(e.progress_pct)}
            style={{ width: 110, accentColor: "var(--acento)" }}
            onMouseUp={(ev) => avance(e.id, Number(ev.target.value))}
            onTouchEnd={(ev) => avance(e.id, Number(ev.target.value))} />
          <span className={"sev " + (Number(e.progress_pct) >= 100 ? "correcto" : "pendiente")}
            style={{ width: 42, textAlign: "right" }}>
            {Math.round(e.progress_pct)}%
          </span>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        <input className="mini" style={{ flex: "1 1 200px" }} placeholder="Nuevo entregable"
          value={nuevo.description} onChange={(e) => setNuevo({ ...nuevo, description: e.target.value })} />
        <input className="mini" type="date" value={nuevo.due_date}
          onChange={(e) => setNuevo({ ...nuevo, due_date: e.target.value })} />
        <input className="mini" type="number" placeholder="Valor plan COP" style={{ width: 140 }}
          value={nuevo.planned_value_cop}
          onChange={(e) => setNuevo({ ...nuevo, planned_value_cop: e.target.value })} />
        <select className="mini" style={{ width: 170 }}
          value={nuevo.responsible_id}
          onChange={(e) => setNuevo({ ...nuevo, responsible_id: e.target.value })}>
          <option value="">— Responsable —</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <button className="btn" disabled={ocupado || !nuevo.description || !nuevo.due_date || !nuevo.planned_value_cop}
          onClick={crear}>Agregar entregable</button>
      </div>
      {msj && <div style={{ color: "var(--critico)", fontSize: 12, marginTop: 8 }}>{msj}</div>}
    </div>
  );
}
