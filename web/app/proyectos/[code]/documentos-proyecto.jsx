"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

// Cargue de contrato y documentación del proyecto: fija la fecha del acto
// (docs_uploaded_at) la primera vez; la URL sí puede actualizarse.
export default function DocumentosProyecto({ projectCode, contractUrl, docsFecha }) {
  const actorId = useSearchParams().get("actor") || "";
  const [url, setUrl] = useState(contractUrl || "");
  const [fecha, setFecha] = useState("");
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    if (!actorId) { setMsj("Elige arriba quién registra."); return; }
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/contratos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "documentos_proyecto", actor_id: Number(actorId),
        project_code: projectCode, contract_url: url, fecha: fecha || undefined }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload(); else { setMsj(j.error || "Error inesperado."); setOcupado(false); }
  }

  return (
    <div className="panelmini" style={{ justifyContent: "flex-start", marginTop: 12 }}>
      <span className="notaf">CONTRATO Y DOCUMENTACIÓN</span>
      {docsFecha
        ? <span className="sev correcto">cargados {docsFecha}</span>
        : contractUrl ? <span className="sev pendiente">carpeta sin fecha de cargue</span>
        : <span className="sev alerta">sin cargar</span>}
      <input className="mini" style={{ flex: "1 1 260px" }} placeholder="URL de la carpeta del contrato"
        value={url} onChange={(e) => setUrl(e.target.value)} />
      {!docsFecha && (
        <input className="mini" type="date" style={{ width: 150 }} value={fecha}
          onChange={(e) => setFecha(e.target.value)} title="Vacío = hoy" />
      )}
      <button className="btn sec" style={{ padding: "5px 14px", fontSize: 12 }} disabled={ocupado || !url.trim()}
        onClick={guardar}>{docsFecha ? "Actualizar URL" : "Registrar cargue"}</button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 11 }}>{msj}</span>}
    </div>
  );
}
