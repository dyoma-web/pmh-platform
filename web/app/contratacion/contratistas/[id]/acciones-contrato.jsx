"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

// Captura de la línea de vida del contrato: firmas (InnovaHub / contratista) y
// entregas (planear, entregar, aprobar, devolver con ronda). Cada acción escribe
// una fecha; ninguna reescribe otra.
export default function AccionesContrato({ contrato, activo, firmas, entregables }) {
  const actorId = useSearchParams().get("actor") || "";
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [fecha, setFecha] = useState("");
  const [nuevo, setNuevo] = useState({ description: "", due_date: "", rounds_agreed: 1 });
  const [motivo, setMotivo] = useState({});

  async function api(payload) {
    if (!actorId) { setMsj("Elige arriba quién actúa."); return; }
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/contratos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, actor_id: Number(actorId), fecha: fecha || undefined }),
    });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (r.ok) {
      if (j.excede_rondas) alert("Atención: esta devolución supera las rondas de ajuste pactadas. Queda registrado.");
      window.location.reload();
    } else setMsj(j.error || "Error inesperado.");
  }

  const bs = { padding: "4px 12px", fontSize: 12 };
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="panelmini" style={{ justifyContent: "flex-start" }}>
        <span className="notaf">FECHA DEL HECHO</span>
        <input className="mini" type="date" style={{ width: 150 }} value={fecha} onChange={(e) => setFecha(e.target.value)}
          title="Vacío = hoy. Úsala para registrar algo que ocurrió otro día." />
        {!firmas.interna && (
          <button className="btn sec" style={bs} disabled={ocupado}
            onClick={() => api({ accion: "firmar", contract_code: contrato, parte: "interna" })}>Firma InnovaHub</button>
        )}
        {!firmas.contratista && (
          <button className="btn sec" style={bs} disabled={ocupado}
            onClick={() => api({ accion: "firmar", contract_code: contrato, parte: "contratista" })}>Firma del contratista</button>
        )}
        {firmas.interna && firmas.contratista && <span className="sev correcto">firmado por ambas partes</span>}
      </div>

      {entregables.length > 0 && (
        <div className="instr">
          {entregables.map((d) => {
            const estado = d.approved_at ? "aprobado" : d.delivered_at ? "entregado" : "planeado";
            return (
              <div className="fila" key={d.id} style={{ alignItems: "center", flexWrap: "wrap" }}>
                <span className="lab">
                  {estado === "aprobado" ? "●" : estado === "entregado" ? "◐" : "○"} {d.description}
                  <span className="mono" style={{ marginLeft: 8 }}>
                    compromiso {d.due} · rondas {d.rounds_used}/{d.rounds_agreed}
                    {d.first_delivered ? ` · entregado ${d.first_delivered}` : ""}{d.approved ? ` · aprobado ${d.approved}` : ""}
                  </span>
                </span>
                <span className={"sev " + (estado === "aprobado" ? "correcto" : estado === "entregado" ? "info" : d.vencido ? "critico" : "pendiente")}>
                  {estado}{d.vencido && estado === "planeado" ? " · vencido" : ""}{d.rounds_used > d.rounds_agreed ? " · excede rondas" : ""}
                </span>
                {activo && !d.approved_at && (
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="btn sec" style={bs} disabled={ocupado}
                      onClick={() => api({ accion: "entregable_entregar", entregable_id: d.id })}>
                      {d.delivered_at ? "Nueva entrega" : "Entregado"}
                    </button>
                    {d.delivered_at && (
                      <>
                        <button className="btn" style={bs} disabled={ocupado}
                          onClick={() => api({ accion: "entregable_aprobar", entregable_id: d.id })}>Aprobar</button>
                        <input className="mini" style={{ width: 170, height: 28 }} placeholder="Motivo de devolución"
                          value={motivo[d.id] || ""} onChange={(e) => setMotivo({ ...motivo, [d.id]: e.target.value })} />
                        <button className="btn sec" style={bs} disabled={ocupado || !(motivo[d.id] || "").trim()}
                          onClick={() => api({ accion: "entregable_devolver", entregable_id: d.id, motivo: motivo[d.id] })}>Devolver (+1 ronda)</button>
                      </>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activo && (
        <div className="panelmini" style={{ justifyContent: "flex-start" }}>
          <span className="notaf">PLANEAR ENTREGA</span>
          <input className="mini" style={{ flex: "1 1 220px" }} placeholder="Producto o entregable"
            value={nuevo.description} onChange={(e) => setNuevo({ ...nuevo, description: e.target.value })} />
          <input className="mini" type="date" style={{ width: 150 }}
            value={nuevo.due_date} onChange={(e) => setNuevo({ ...nuevo, due_date: e.target.value })} />
          <label className="notaf" style={{ display: "flex", alignItems: "center", gap: 4 }}>RONDAS
            <input className="mini" type="number" min="0" style={{ width: 60 }}
              value={nuevo.rounds_agreed} onChange={(e) => setNuevo({ ...nuevo, rounds_agreed: e.target.value })} /></label>
          <button className="btn" style={bs} disabled={ocupado || !nuevo.description.trim() || !nuevo.due_date}
            onClick={() => api({ accion: "entregable_crear", contract_code: contrato, ...nuevo, rounds_agreed: Number(nuevo.rounds_agreed) })}>
            Agregar al plan
          </button>
        </div>
      )}
      {msj && <div style={{ color: "var(--critico)", fontSize: 12 }}>{msj}</div>}
    </div>
  );
}
