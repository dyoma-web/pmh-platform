"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

// Capturas del expediente 360: evaluación (por contrato terminado), documento
// con vigencia, nota de bitácora y cambio de estado de la relación.
export default function Acciones360({ contratistaId, modo, contrato, estadoActual }) {
  const actorId = useSearchParams().get("actor") || "";
  const [abierto, setAbierto] = useState(false);
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [f, setF] = useState({ q_calidad: 4, q_fechas: 4, q_comunicacion: 4, q_autonomia: 4,
    rondas_ajustes: "", desviacion_dias: "", hecho: "",
    tipo: "seguridad_social", periodo: "", url: "", nota: "", estado: estadoActual || "activo", motivo: "" });
  const set = (k, v) => setF({ ...f, [k]: v });

  async function api(payload) {
    if (!actorId) { setMsj("Elige arriba quién actúa."); return false; }
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/contratistas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, actor_id: Number(actorId), contratista_id: contratistaId }),
    });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (r.ok) { window.location.reload(); return true; }
    setMsj(j.error || "Error inesperado.");
    return false;
  }

  if (!abierto) {
    const ETIQ = { review: "Evaluar servicio", documento: "Agregar documento",
      nota: "Nota / estado de la relación" };
    return (
      <span>
        <button className="btn sec" style={{ padding: "4px 12px", fontSize: 12 }}
          onClick={() => setAbierto(true)}>{ETIQ[modo]}</button>
        {msj && <div style={{ color: "var(--critico)", fontSize: 11 }}>{msj}</div>}
      </span>
    );
  }

  if (modo === "review") {
    return (
      <div className="panelmini" style={{ justifyContent: "flex-start", maxWidth: 560 }}>
        {[["q_calidad", "Calidad"], ["q_fechas", "Fechas"], ["q_comunicacion", "Comunic."],
          ["q_autonomia", "Autonomía"]].map(([k, lbl]) => (
          <label key={k} style={{ fontSize: 11, color: "var(--tinta-2)" }}>
            {lbl}
            <select className="mini" style={{ width: 58, height: 28, display: "block" }}
              value={f[k]} onChange={(e) => set(k, Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
        ))}
        <label style={{ fontSize: 11, color: "var(--tinta-2)" }}>Rondas
          <input className="mini" type="number" min="0" style={{ width: 64, height: 28, display: "block" }}
            value={f.rondas_ajustes} onChange={(e) => set("rondas_ajustes", e.target.value)} /></label>
        <label style={{ fontSize: 11, color: "var(--tinta-2)" }}>Entrega ±d
          <input className="mini" type="number" style={{ width: 70, height: 28, display: "block" }}
            value={f.desviacion_dias} onChange={(e) => set("desviacion_dias", e.target.value)} /></label>
        <input className="mini" style={{ flex: "1 1 100%", height: 30 }}
          placeholder="Un hecho verificable (qué pasó, no qué opinas)"
          value={f.hecho} onChange={(e) => set("hecho", e.target.value)} />
        <button className="btn" style={{ padding: "5px 14px", fontSize: 12 }} disabled={ocupado}
          onClick={() => api({ accion: "review_crear", contract_code: contrato,
            q_calidad: f.q_calidad, q_fechas: f.q_fechas, q_comunicacion: f.q_comunicacion,
            q_autonomia: f.q_autonomia,
            rondas_ajustes: f.rondas_ajustes === "" ? undefined : Number(f.rondas_ajustes),
            desviacion_dias: f.desviacion_dias === "" ? undefined : Number(f.desviacion_dias),
            hecho: f.hecho })}>
          Guardar evaluación
        </button>
        <button className="btn sec" style={{ padding: "5px 12px", fontSize: 12 }}
          onClick={() => setAbierto(false)}>Cerrar</button>
        {msj && <div style={{ color: "var(--critico)", fontSize: 11, flexBasis: "100%" }}>{msj}</div>}
      </div>
    );
  }

  if (modo === "documento") {
    return (
      <div className="panelmini" style={{ justifyContent: "flex-start", marginTop: 12 }}>
        <select className="mini" style={{ width: 180 }} value={f.tipo}
          onChange={(e) => set("tipo", e.target.value)}>
          <option value="seguridad_social">Seguridad social (mes)</option>
          <option value="rut">RUT (año)</option>
          <option value="cert_bancaria">Certificación bancaria</option>
          <option value="autorizacion_1581">Autorización Ley 1581</option>
          <option value="certificacion">Certificación profesional</option>
        </select>
        {["seguridad_social", "rut"].includes(f.tipo) && (
          <input className="mini" style={{ width: 130 }}
            type={f.tipo === "seguridad_social" ? "month" : "number"}
            placeholder={f.tipo === "rut" ? "Año" : ""}
            value={f.periodo} onChange={(e) => set("periodo", e.target.value)} />
        )}
        <input className="mini" style={{ flex: "1 1 220px" }} placeholder="URL del documento"
          value={f.url} onChange={(e) => set("url", e.target.value)} />
        <button className="btn" style={{ padding: "5px 14px", fontSize: 12 }} disabled={ocupado}
          onClick={() => api({ accion: "documento_agregar", tipo: f.tipo,
            periodo: f.periodo || undefined, url: f.url })}>Guardar documento</button>
        <button className="btn sec" style={{ padding: "5px 12px", fontSize: 12 }}
          onClick={() => setAbierto(false)}>Cerrar</button>
        {msj && <span style={{ color: "var(--critico)", fontSize: 11 }}>{msj}</span>}
      </div>
    );
  }

  // nota + estado de relación
  return (
    <div className="panelmini" style={{ justifyContent: "flex-start", marginTop: 12 }}>
      <input className="mini" style={{ flex: "1 1 240px" }} placeholder="Nota de la relación"
        value={f.nota} onChange={(e) => set("nota", e.target.value)} />
      <button className="btn" style={{ padding: "5px 14px", fontSize: 12 }}
        disabled={ocupado || !f.nota.trim()}
        onClick={() => api({ accion: "nota_crear", nota: f.nota })}>Guardar nota</button>
      <select className="mini" style={{ width: 150 }} value={f.estado}
        onChange={(e) => set("estado", e.target.value)}>
        <option value="en_vinculacion">En vinculación</option>
        <option value="activo">Activo</option>
        <option value="inactivo">Inactivo</option>
        <option value="no_elegible">No elegible</option>
      </select>
      <input className="mini" style={{ width: 180 }} placeholder="Motivo (si cambia estado)"
        value={f.motivo} onChange={(e) => set("motivo", e.target.value)} />
      <button className="btn sec" style={{ padding: "5px 14px", fontSize: 12 }} disabled={ocupado}
        onClick={() => api({ accion: "estado_relacion", estado: f.estado, motivo: f.motivo || undefined })}>
        Cambiar estado
      </button>
      <button className="btn sec" style={{ padding: "5px 12px", fontSize: 12 }}
        onClick={() => setAbierto(false)}>Cerrar</button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 11 }}>{msj}</span>}
    </div>
  );
}
