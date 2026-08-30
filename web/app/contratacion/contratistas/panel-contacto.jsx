"use client";
import { useState } from "react";

// «Ver datos de contacto»: la consulta se registra en audit.event_log.
// Editar (solo administración) permite completar teléfono, correo, carpeta
// y la URL de la autorización de tratamiento de datos.
export default function PanelContacto({ contratistaId, actorId }) {
  const [abierto, setAbierto] = useState(false);
  const [c, setC] = useState(null);
  const [msj, setMsj] = useState(null);
  const [edit, setEdit] = useState({ phone: "", email: "", folder_url: "", autorizacion_url: "" });
  const [ocupado, setOcupado] = useState(false);

  async function api(payload) {
    const r = await fetch("/api/contratistas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, actor_id: Number(actorId), contratista_id: contratistaId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Error inesperado.");
    return j;
  }

  async function ver() {
    if (!actorId) { setMsj("Elige arriba quién consulta."); return; }
    setOcupado(true); setMsj(null);
    try {
      const j = await api({ accion: "contacto_ver" });
      setC(j.contacto); setAbierto(true);
      setEdit({ phone: j.contacto.phone || "", email: j.contacto.email || "",
        folder_url: j.contacto.folder_url || "", autorizacion_url: "" });
    } catch (e) { setMsj(e.message); }
    setOcupado(false);
  }

  async function guardar() {
    setOcupado(true); setMsj(null);
    try {
      await api({ accion: "contacto_actualizar", ...edit,
        autorizacion_url: edit.autorizacion_url || undefined });
      setMsj("Guardado.");
      await ver();
    } catch (e) { setMsj(e.message); }
    setOcupado(false);
  }

  if (!abierto) {
    return (
      <div>
        <button className="btn sec" style={{ padding: "4px 12px", fontSize: 12 }}
          disabled={ocupado} onClick={ver}>Ver contacto</button>
        {msj && <div style={{ color: "var(--critico)", fontSize: 11 }}>{msj}</div>}
      </div>
    );
  }
  return (
    <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4, minWidth: 230, padding: "6px 0" }}>
      <div style={{ fontFamily: "var(--fx-mono)", fontSize: 11 }}>
        {c.id_type} {c.id_number} · {c.legal_name}
      </div>
      <input className="mini" style={{ width: "100%", height: 28 }} placeholder="teléfono"
        value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
      <input className="mini" style={{ width: "100%", height: 28 }} placeholder="correo"
        value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
      <input className="mini" style={{ width: "100%", height: 28 }} placeholder="carpeta (URL)"
        value={edit.folder_url} onChange={(e) => setEdit({ ...edit, folder_url: e.target.value })} />
      <input className="mini" style={{ width: "100%", height: 28 }}
        placeholder={c.autorizacion ? "autorización registrada ✓ (URL nueva reemplaza)" : "URL autorización Ley 1581"}
        value={edit.autorizacion_url} onChange={(e) => setEdit({ ...edit, autorizacion_url: e.target.value })} />
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn" style={{ padding: "4px 12px", fontSize: 12 }}
          disabled={ocupado} onClick={guardar}>Guardar contacto</button>
        <button className="btn sec" style={{ padding: "4px 12px", fontSize: 12 }}
          onClick={() => setAbierto(false)}>Cerrar</button>
      </div>
      {msj && <div style={{ color: msj === "Guardado." ? "var(--correcto)" : "var(--critico)" }}>{msj}</div>}
      <div className="notaf">consulta registrada en auditoría</div>
    </div>
  );
}
