"use client";
import { useMemo, useState } from "react";

const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const $ = (v) => "$ " + nf.format(Math.round(v || 0));
const slugify = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9ñ]+/g, "_").replace(/^_|_$/g, "");

const PASOS = ["Identidad", "Cliente y contrato", "Financiero", "Presupuesto por ítem", "Fechas e hitos"];

export default function Wizard({ usuarios, clientes, paises, lineas, orgs, frameworks,
  items, trm, defaults, prefijos }) {
  const [paso, setPaso] = useState(0);
  const [actor, setActor] = useState("");
  const [f, setF] = useState({
    prefijo: "", tema: "", anio: new Date().getFullYear(),
    cliente_id: "", country: "", service_line: "", org_entity: "InnovaHub Colombia SAS",
    framework_code: "",
    monto: "", moneda: "USD", fx: trm ? String(trm) : "", fx_kind: "mercado",
    p_margin: defaults.p_margin ?? 12, p_ayf: defaults.p_ayf ?? 12,
    p_unforeseen: defaults.p_unforeseen ?? 3, p_ica: defaults.p_ica ?? 1,
    p_commission: defaults.p_commission ?? 0,
    start_date: "", closing_date: "",
  });
  const [lineasP, setLineasP] = useState([{ ihpsc_code: "", description: "", unit: "", qty: "", unit_price: "" }]);
  const [hitos, setHitos] = useState([{ amount_cop: "", expected_date: "", deliverables: "" }]);
  const [msj, setMsj] = useState(null);
  const [ok, setOk] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });

  const clienteNombre = clientes.find((c) => String(c.id) === String(f.cliente_id))?.name ?? "";
  const code = useMemo(() => {
    const partes = [f.prefijo, slugify(clienteNombre).split("_")[0], slugify(f.tema), f.anio]
      .filter(Boolean);
    return partes.length >= 3 ? partes.join("_") : "";
  }, [f.prefijo, clienteNombre, f.tema, f.anio]);

  const fxRate = f.moneda === "COP" ? 1 : Number(f.fx) || 0;
  const montoCop = (Number(f.monto) || 0) * fxRate;
  const sumaPct = ["p_margin", "p_ayf", "p_unforeseen", "p_ica", "p_commission"]
    .reduce((s, k) => s + (Number(f[k]) || 0), 0);
  const impl = montoCop * (1 - sumaPct / 100);
  const reserva = impl * 0.2;
  const gestion = impl * 0.8;
  const totalPres = lineasP.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
  const cobertura = impl > 0 ? (totalPres / impl) * 100 : 0;
  const totalHitos = hitos.reduce((s, h) => s + (Number(h.amount_cop) || 0), 0);
  const hitosOk = montoCop > 0 && Math.abs(totalHitos - montoCop) <= montoCop * 0.01;

  const validaciones = [
    [!!code, "Código canónico generado", code || "elige prefijo, cliente, tema y año"],
    [!!f.cliente_id && !!f.country && !!f.service_line, "Cliente, país y línea de servicio", ""],
    [montoCop > 0 && fxRate > 0, "Monto, moneda y TRM capturados juntos",
      montoCop > 0 ? `${$(montoCop)} COP` : ""],
    [cobertura >= 99.9, "Presupuesto cubre el 100 % de implementación",
      impl > 0 ? `${nf.format(Math.round(cobertura))} % de ${$(impl)}` : ""],
    [hitos.some((h) => h.amount_cop && h.expected_date) && hitosOk,
      "Hitos suman el valor del proyecto",
      montoCop ? `${$(totalHitos)} de ${$(montoCop)}` : ""],
    [!!f.start_date && !!f.closing_date && f.closing_date > f.start_date, "Fechas de inicio y cierre", ""],
  ];
  const todoOk = validaciones.every((v) => v[0]);

  async function crear() {
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/proyectos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "crear_completo", actor_id: Number(actor), code,
        cliente_id: Number(f.cliente_id), country: f.country, service_line: f.service_line,
        org_entity: f.org_entity, framework_code: f.framework_code || undefined,
        monto: Number(f.monto), moneda: f.moneda, fx: fxRate, fx_kind: f.fx_kind,
        porcentajes: { p_margin: f.p_margin, p_ayf: f.p_ayf, p_unforeseen: f.p_unforeseen,
          p_ica: f.p_ica, p_commission: f.p_commission },
        start_date: f.start_date, closing_date: f.closing_date,
        presupuesto: lineasP.filter((l) => l.description && l.qty && l.unit_price),
        hitos: hitos.filter((h) => h.amount_cop && h.expected_date)
          .map((h) => ({ ...h, amount_cop: Number(h.amount_cop) })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (r.ok) setOk(j);
    else setMsj(j.error || "Error inesperado.");
  }

  async function activar() {
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/proyectos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "aprobar_y_activar", actor_id: Number(actor), code: ok.code }),
    });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (r.ok) window.location.href = `/proyectos/${encodeURIComponent(ok.code)}`;
    else setMsj(j.error || "Error inesperado.");
  }

  const sel = { height: 40, border: "1px solid var(--filete)", borderRadius: 8, padding: "0 10px",
    font: "13px var(--fx-archivo)", background: "var(--plancha)", color: "var(--tinta-1)" };
  const esAdmin = usuarios.find((u) => String(u.id) === String(actor))?.admin;

  if (ok) {
    return (
      <section className="plancha">
        <div className="vacio">
          <div className="t">Proyecto {ok.code} creado en borrador.</div>
          <div className="d">
            Presupuesto en borrador por {$(totalPres)}. {esAdmin
              ? "Puedes aprobarlo y activarlo ahora:"
              : "Administración debe aprobar el presupuesto para activarlo."}
          </div>
          {esAdmin && (
            <button className="btn" style={{ marginTop: 14 }} disabled={ocupado} onClick={activar}>
              Aprobar presupuesto y activar
            </button>
          )}
          {msj && <div style={{ color: "var(--critico)", marginTop: 10 }}>{msj}</div>}
        </div>
      </section>
    );
  }

  return (
    <div className="g32">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <section className="plancha">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select style={sel} value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">— Quién registra —</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
            {PASOS.map((p, i) => (
              <button key={p} className={"btn " + (i === paso ? "" : "sec")}
                style={{ padding: "6px 14px", fontSize: 12 }}
                onClick={() => setPaso(i)}>{i + 1} · {p}</button>
            ))}
          </div>
        </section>

        {paso === 0 && (
          <section className="plancha">
            <h2>Identidad <span className="mid">{code ? `CÓDIGO: ${code}` : "EL CÓDIGO SE GENERA SOLO"}</span></h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input className="mini" list="prefijos" placeholder="Prefijo país (co, pa…)"
                style={{ width: 150 }} value={f.prefijo}
                onChange={(e) => set("prefijo", slugify(e.target.value))} />
              <datalist id="prefijos">{prefijos.map((p) => <option key={p} value={p} />)}</datalist>
              <input className="mini" style={{ flex: "1 1 240px" }} placeholder="Tema (p. ej. formacion_tecnica)"
                value={f.tema} onChange={(e) => set("tema", e.target.value)} />
              <input className="mini" type="number" style={{ width: 100 }} value={f.anio}
                onChange={(e) => set("anio", e.target.value)} />
              <select style={sel} value={f.service_line} onChange={(e) => set("service_line", e.target.value)}>
                <option value="">— Línea —</option>
                {lineas.map((l) => <option key={l.code} value={l.code}>{l.code}</option>)}
              </select>
            </div>
          </section>
        )}

        {paso === 1 && (
          <section className="plancha">
            <h2>Cliente y contrato</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select style={{ ...sel, minWidth: 200 }} value={f.cliente_id}
                onChange={(e) => set("cliente_id", e.target.value)}>
                <option value="">— Cliente —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select style={sel} value={f.country} onChange={(e) => set("country", e.target.value)}>
                <option value="">— País —</option>
                {paises.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <select style={sel} value={f.org_entity} onChange={(e) => set("org_entity", e.target.value)}>
                {orgs.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
              <select style={{ ...sel, minWidth: 220 }} value={f.framework_code}
                onChange={(e) => set("framework_code", e.target.value)}>
                <option value="">— Contrato marco (opcional) —</option>
                {frameworks.map((k) => <option key={k.code} value={k.code}>{k.code}</option>)}
              </select>
            </div>
          </section>
        )}

        {paso === 2 && (
          <section className="plancha">
            <h2>Financiero <span className="mid">EL COSTEO SE CALCULA, NO SE DIGITA</span></h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input className="mini" type="number" min="0" placeholder="Monto adjudicado"
                style={{ width: 170 }} value={f.monto} onChange={(e) => set("monto", e.target.value)} />
              <select style={sel} value={f.moneda} onChange={(e) => set("moneda", e.target.value)}>
                {["USD", "COP", "EUR", "CLP"].map((m) => <option key={m}>{m}</option>)}
              </select>
              {f.moneda !== "COP" && (
                <>
                  <input className="mini" type="number" step="0.01" style={{ width: 130 }}
                    value={f.fx} onChange={(e) => set("fx", e.target.value)} title="TRM" />
                  <select style={sel} value={f.fx_kind} onChange={(e) => set("fx_kind", e.target.value)}>
                    <option value="mercado">TRM de mercado{trm ? ` (hoy ${nf.format(trm)})` : ""}</option>
                    <option value="pactada">TRM pactada en contrato</option>
                  </select>
                </>
              )}
              <span className="mono" style={{ fontFamily: "var(--fx-mono)", fontSize: 13 }}>
                = {$(montoCop)} COP
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {[["p_margin", "Margen"], ["p_ayf", "A y F"], ["p_unforeseen", "Imprevistos"],
                ["p_ica", "ICA"], ["p_commission", "Comisión"]].map(([k, lbl]) => (
                <label key={k} style={{ fontSize: 12, color: "var(--tinta-2)" }}>
                  {lbl} %
                  <input className="mini" type="number" step="0.5" style={{ width: 80, display: "block" }}
                    value={f[k]} onChange={(e) => set(k, e.target.value)} />
                </label>
              ))}
            </div>
            <div className="instr" style={{ marginTop: 14, maxWidth: 460 }}>
              <div className="fila"><span className="lab">Implementación ({nf.format(100 - sumaPct)} %)</span>
                <span className="val">{$(impl)}</span></div>
              <div className="fila"><span className="lab">Reserva 20 %</span><span className="val">{$(reserva)}</span></div>
              <div className="fila"><span className="lab">Presupuesto de gestión 80 %</span><span className="val">{$(gestion)}</span></div>
            </div>
          </section>
        )}

        {paso === 3 && (
          <section className="plancha">
            <h2>Presupuesto por ítem{" "}
              <span className="mid" style={{ color: cobertura >= 99.9 ? "var(--correcto)" : "var(--critico)" }}>
                {$(totalPres)} · {nf.format(Math.round(cobertura))} % DE LA IMPLEMENTACIÓN
              </span></h2>
            {lineasP.map((l, i) => {
              const item = items.find((x) => x.code === l.ihpsc_code);
              return (
                <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <select style={{ ...sel, height: 32, minWidth: 230, fontSize: 12 }}
                    value={l.ihpsc_code}
                    onChange={(e) => {
                      const it = items.find((x) => x.code === e.target.value);
                      setLineasP(lineasP.map((x, ix) => ix === i ? {
                        ...x, ihpsc_code: e.target.value,
                        description: x.description || it?.name || "",
                        unit: x.unit || it?.unit || "",
                        unit_price: x.unit_price || (it?.ref_cost ?? ""),
                      } : x));
                    }}>
                    <option value="">— Ítem IHPSC (opcional) —</option>
                    {items.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name?.slice(0, 40)}</option>)}
                  </select>
                  <input className="mini" style={{ flex: "1 1 180px" }} placeholder="Descripción"
                    value={l.description}
                    onChange={(e) => setLineasP(lineasP.map((x, ix) => ix === i ? { ...x, description: e.target.value } : x))} />
                  <input className="mini" style={{ width: 90 }} placeholder="Unidad" value={l.unit}
                    onChange={(e) => setLineasP(lineasP.map((x, ix) => ix === i ? { ...x, unit: e.target.value } : x))} />
                  <input className="mini" type="number" style={{ width: 80 }} placeholder="Cant." value={l.qty}
                    onChange={(e) => setLineasP(lineasP.map((x, ix) => ix === i ? { ...x, qty: e.target.value } : x))} />
                  <input className="mini" type="number" style={{ width: 130 }} placeholder="P. unitario"
                    title={item?.ref_cost ? `Costo ref. del catálogo: ${$(item.ref_cost)}` : ""}
                    value={l.unit_price}
                    onChange={(e) => setLineasP(lineasP.map((x, ix) => ix === i ? { ...x, unit_price: e.target.value } : x))} />
                </div>
              );
            })}
            <button className="btn sec" onClick={() => setLineasP([...lineasP, { ihpsc_code: "", description: "", unit: "", qty: "", unit_price: "" }])}>
              Agregar línea
            </button>
          </section>
        )}

        {paso === 4 && (
          <section className="plancha">
            <h2>Fechas e hitos de ingreso{" "}
              <span className="mid" style={{ color: hitosOk ? "var(--correcto)" : "var(--critico)" }}>
                {$(totalHitos)} DE {$(montoCop)}
              </span></h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--tinta-2)" }}>Inicio
                <input className="mini" type="date" style={{ display: "block" }} value={f.start_date}
                  onChange={(e) => set("start_date", e.target.value)} /></label>
              <label style={{ fontSize: 12, color: "var(--tinta-2)" }}>Cierre
                <input className="mini" type="date" style={{ display: "block" }} value={f.closing_date}
                  onChange={(e) => set("closing_date", e.target.value)} /></label>
            </div>
            {hitos.map((h, i) => (
              <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <input className="mini" type="number" style={{ width: 150 }} placeholder="Monto COP"
                  value={h.amount_cop}
                  onChange={(e) => setHitos(hitos.map((x, ix) => ix === i ? { ...x, amount_cop: e.target.value } : x))} />
                <input className="mini" type="date" value={h.expected_date}
                  onChange={(e) => setHitos(hitos.map((x, ix) => ix === i ? { ...x, expected_date: e.target.value } : x))} />
                <input className="mini" style={{ flex: "1 1 220px" }} placeholder="Entregables del hito"
                  value={h.deliverables}
                  onChange={(e) => setHitos(hitos.map((x, ix) => ix === i ? { ...x, deliverables: e.target.value } : x))} />
              </div>
            ))}
            <button className="btn sec" onClick={() => setHitos([...hitos, { amount_cop: "", expected_date: "", deliverables: "" }])}>
              Agregar hito
            </button>
          </section>
        )}
      </div>

      <section className="plancha" style={{ alignSelf: "start", position: "sticky", top: 80 }}>
        <h2>Validaciones para activar <span className="mid">BLOQUEANTES</span></h2>
        <div className="instr">
          {validaciones.map(([ok2, lbl, det], i) => (
            <div className="fila" key={i}>
              <span className={"sev " + (ok2 ? "correcto" : "critico")}>{ok2 ? "✓" : "✕"}</span>
              <span className="lab">{lbl}
                {det && <span className="mono" style={{ marginLeft: 8, fontSize: 11 }}>{det}</span>}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "var(--tinta-2)" }}>
          Mientras falten validaciones el proyecto solo puede guardarse como borrador
          y aparecerá en Mi día hasta completarlo.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" disabled={ocupado || !actor || !todoOk} onClick={crear}>
            Crear proyecto (borrador + presupuesto)
          </button>
        </div>
        {msj && <div style={{ color: "var(--critico)", fontSize: 13, marginTop: 10 }}>{msj}</div>}
      </section>
    </div>
  );
}
