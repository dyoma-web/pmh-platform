"use client";
import { useMemo, useState } from "react";

const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const filaServicio = () => ({ description: "", unit: "", qty: "", unit_price: "", deliverable: "", due_date: "" });
const filaPago = () => ({ due_date: "", amount: "", method: "Disaggregated" });

export default function FormularioSolicitud({ usuarios, proyectos, contratistas, actorInicial }) {
  const [actor, setActor] = useState(actorInicial);
  const [proyecto, setProyecto] = useState("");
  const [contratista, setContratista] = useState("");
  const [categoria, setCategoria] = useState("OS");
  const [payor, setPayor] = useState("InnovaHub Colombia SAS");
  const [ihCapacity, setIhCapacity] = useState(false);
  const [notas, setNotas] = useState("");
  const [servicios, setServicios] = useState([filaServicio()]);
  const [pagos, setPagos] = useState([filaPago()]);
  const [msj, setMsj] = useState(null);
  const [ok, setOk] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const totalServicios = useMemo(
    () => servicios.reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.unit_price) || 0), 0),
    [servicios]);
  const totalPagos = useMemo(
    () => pagos.reduce((s, x) => s + (Number(x.amount) || 0), 0), [pagos]);
  const cuadra = Math.abs(totalServicios - totalPagos) <= 1 && totalServicios > 0;

  const setServ = (i, k, v) =>
    setServicios(servicios.map((s, ix) => (ix === i ? { ...s, [k]: v } : s)));
  const setPag = (i, k, v) =>
    setPagos(pagos.map((p, ix) => (ix === i ? { ...p, [k]: v } : p)));

  async function enviar() {
    setMsj(null); setOcupado(true);
    const r = await fetch("/api/solicitudes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "crear", actor_id: Number(actor), project_code: proyecto,
        contractor_id: Number(contratista), category: categoria, payor,
        ih_capacity: ihCapacity, annotations: notas || undefined,
        servicios: servicios.filter((s) => s.description),
        pagos: pagos.filter((p) => p.amount),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (r.ok) setOk(j);
    else setMsj(j.error || "Error inesperado.");
  }

  if (ok) {
    return (
      <section className="plancha">
        <div className="vacio">
          <div className="t">Solicitud {ok.code} creada por $ {nf.format(ok.total)} COP.</div>
          <div className="d">
            Administración la verá en su cola para procesarla en contrato.{" "}
            <a href={`/contratacion/solicitudes?actor=${actor}`}>Volver a solicitudes</a>
          </div>
        </div>
      </section>
    );
  }

  const sel = { height: 40, border: "1px solid var(--filete)", borderRadius: 8, padding: "0 10px",
    font: "13px var(--fx-archivo)", background: "var(--plancha)", color: "var(--tinta-1)" };

  return (
    <>
      <section className="plancha">
        <h2>Quién, para qué proyecto, a quién</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select style={sel} value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">— Solicita (gestora) —</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select style={{ ...sel, minWidth: 280 }} value={proyecto} onChange={(e) => setProyecto(e.target.value)}>
            <option value="">— Proyecto —</option>
            {proyectos.map((p) => <option key={p.code} value={p.code}>{p.display_code}</option>)}
          </select>
          <select style={{ ...sel, minWidth: 240 }} value={contratista} onChange={(e) => setContratista(e.target.value)}>
            <option value="">— Contratista —</option>
            {contratistas.map((c) => (
              <option key={c.id} value={c.id}>{c.display_name}{c.profile ? ` · ${c.profile}` : ""}</option>
            ))}
          </select>
          <select style={sel} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="OS">OS · por entregables</option>
            <option value="PS">PS · prestación de servicios</option>
          </select>
          <select style={sel} value={payor} onChange={(e) => setPayor(e.target.value)}>
            <option>InnovaHub Colombia SAS</option>
            <option>InnovaHub LLC</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={ihCapacity} onChange={(e) => setIhCapacity(e.target.checked)} />
            hay capacidad interna (se contrata por carga)
          </label>
        </div>
        <input className="mini" style={{ width: "100%", marginTop: 10 }}
          placeholder="Notas para administración (opcional)"
          value={notas} onChange={(e) => setNotas(e.target.value)} />
      </section>

      <section className="plancha">
        <h2>Servicios <span className="mid">TOTAL $ {nf.format(totalServicios)} COP</span></h2>
        {servicios.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input className="mini" style={{ flex: "2 1 240px" }} placeholder="Descripción del servicio"
              value={s.description} onChange={(e) => setServ(i, "description", e.target.value)} />
            <input className="mini" style={{ width: 120 }} placeholder="Unidad"
              value={s.unit} onChange={(e) => setServ(i, "unit", e.target.value)} />
            <input className="mini" style={{ width: 90 }} placeholder="Cant." type="number" min="0"
              value={s.qty} onChange={(e) => setServ(i, "qty", e.target.value)} />
            <input className="mini" style={{ width: 140 }} placeholder="Precio unitario" type="number" min="0"
              value={s.unit_price} onChange={(e) => setServ(i, "unit_price", e.target.value)} />
            <input className="mini" style={{ flex: "1 1 180px" }} placeholder="Entregable"
              value={s.deliverable} onChange={(e) => setServ(i, "deliverable", e.target.value)} />
            <input className="mini" style={{ width: 150 }} type="date"
              value={s.due_date} onChange={(e) => setServ(i, "due_date", e.target.value)} />
          </div>
        ))}
        <button className="btn sec" onClick={() => setServicios([...servicios, filaServicio()])}>
          Agregar servicio
        </button>
      </section>

      <section className="plancha">
        <h2>
          Plan de pagos{" "}
          <span className="mid" style={{ color: cuadra ? "var(--correcto)" : "var(--critico)" }}>
            $ {nf.format(totalPagos)} COP · {cuadra ? "CUADRA" : "DEBE SUMAR LO MISMO QUE LOS SERVICIOS"}
          </span>
        </h2>
        {pagos.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input className="mini" style={{ width: 150 }} type="date"
              value={p.due_date} onChange={(e) => setPag(i, "due_date", e.target.value)} />
            <input className="mini" style={{ width: 160 }} placeholder="Monto COP" type="number" min="0"
              value={p.amount} onChange={(e) => setPag(i, "amount", e.target.value)} />
            <select className="mini" style={{ width: 160 }}
              value={p.method} onChange={(e) => setPag(i, "method", e.target.value)}>
              <option value="Disaggregated">Por cuotas</option>
              <option value="Unique">Pago único</option>
            </select>
          </div>
        ))}
        <button className="btn sec" onClick={() => setPagos([...pagos, filaPago()])}>
          Agregar pago
        </button>
      </section>

      <section className="plancha" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" disabled={ocupado || !actor || !proyecto || !contratista || !cuadra}
          onClick={enviar}>
          Crear solicitud de contratación
        </button>
        {!cuadra && totalServicios > 0 && (
          <span style={{ fontSize: 13, color: "var(--tinta-2)" }}>
            Diferencia: $ {nf.format(Math.abs(totalServicios - totalPagos))} COP
          </span>
        )}
        {msj && <span style={{ color: "var(--critico)", fontSize: 13 }}>{msj}</span>}
      </section>
    </>
  );
}
