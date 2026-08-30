import Link from "next/link";
import { q } from "../../../lib/db";
import { cop, n0, n1, fecha } from "../../../lib/fmt";
import Historia from "../../historia";

export const dynamic = "force-dynamic";

// Comparador por producto — SOLO gestoras/administración.
// Regla de honestidad: las barras solo comparan precios DENTRO de la misma
// unidad (un $/minuto no se compara con un $/OVA). El alcance exacto por línea
// (20 vs 40 slides) llegará con el módulo de presupuestación y seguimiento de
// producto; mientras tanto, cada fila se expande para ver QUÉ cobró exactamente.

const ORDENES = {
  precio_asc: ["Más barato primero", "precio_prom asc"],
  precio_desc: ["Más caro primero", "precio_prom desc"],
  nombre: ["Alfabético", "display_name asc"],
  monto: ["Mayor monto", "monto_total desc"],
};

export default async function Comparador({ searchParams }) {
  const sp = await searchParams;
  const orden = ORDENES[sp?.orden] ? sp.orden : "precio_asc";
  const sel = (sp?.sel || "").split(",").filter(Boolean).map(Number);

  const grupos = await q(`
    select ihpsc_group, count(*) contratistas, sum(monto_total) monto
    from metrics.v2_comparador group by 1 order by monto desc`);
  const grupo = sp?.grupo || grupos[0]?.ihpsc_group || "";

  const todas = await q(
    `select * from metrics.v2_comparador where ihpsc_group = $1
     order by ${ORDENES[orden][1]} nulls last`, [grupo]);
  const filas = sel.length ? todas.filter((f) => sel.includes(Number(f.contractor_id))) : todas;

  const lineas = await q(
    `select hr.contractor_id, s.description, s.unit, s.qty, s.unit_price, s.total,
            s.due_date, p.display_code proyecto
     from procurement.request_service s
     join procurement.hiring_request hr on hr.code = s.request_code
     join core.project p on p.id = hr.project_id
     where s.ihpsc_group = $1 and hr.state = 'processed'
     order by s.due_date desc`, [grupo]);
  const lineasPor = {};
  for (const l of lineas) (lineasPor[l.contractor_id] ??= []).push(l);

  // barras por unidad: solo se comparan pares de la misma unidad
  const porUnidad = {};
  for (const f of filas) (porUnidad[f.unidad_comun ?? "sin unidad"] ??= []).push(f);
  const unidades = Object.entries(porUnidad).sort((a, b) => b[1].length - a[1].length);

  const link = (patch) => {
    const p = new URLSearchParams({ grupo, orden, ...(sel.length ? { sel: sel.join(",") } : {}), ...patch });
    if (patch.sel === "") p.delete("sel");
    return `/contratacion/comparador?${p.toString()}`;
  };
  const toggleSel = (id) => {
    const s = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    return link({ sel: s.join(",") });
  };

  const multiUnidad = unidades.length > 1;

  return (
    <>
      <Historia
        num="04"
        seccion="Contratación · Comparador"
        titulo={
          multiUnidad
            ? "Mismo producto, unidades distintas: compara con cuidado"
            : filas.length > 1
              ? `${filas.length} contratistas comparables en ${grupo.split("·")[0].trim()}`
              : "Comparador de contratistas por producto"
        }
        lede={`Precios de líneas de servicio reales. Las barras solo comparan dentro de la misma unidad — un $/minuto no se compara con un $/OVA — y cada contratista se expande para ver qué cobró exactamente (un OVA de 20 slides no es uno de 40: el alcance por línea llegará con el módulo de presupuestación y seguimiento de producto). Caro no significa malo: la evaluación va al lado del precio.`}
        lado={<span className="notaf">SOLO INTERNO · {n0(lineas.length)} LÍNEAS REALES</span>}
      />
      <div className="contenido">
        <section className="plancha">
          <div className="vercomo" style={{ marginBottom: 10 }}>
            <span className="notaf" style={{ marginRight: 6 }}>PRODUCTO</span>
            {grupos.map((g) => (
              <Link key={g.ihpsc_group}
                href={`/contratacion/comparador?grupo=${encodeURIComponent(g.ihpsc_group)}&orden=${orden}`}
                className={g.ihpsc_group === grupo ? "on" : ""}>
                {g.ihpsc_group.split("·")[0].trim()} ({g.contratistas})
              </Link>
            ))}
          </div>
          <div className="vercomo" style={{ marginBottom: 10 }}>
            <span className="notaf" style={{ marginRight: 6 }}>ORDEN</span>
            {Object.entries(ORDENES).map(([k, [lbl]]) => (
              <Link key={k} href={link({ orden: k })} className={k === orden ? "on" : ""}>{lbl}</Link>
            ))}
          </div>
          <div className="vercomo">
            <span className="notaf" style={{ marginRight: 6 }}>COMPARAR</span>
            <Link href={link({ sel: "" })} className={!sel.length ? "on" : ""}>Todos</Link>
            {todas.map((f) => (
              <Link key={f.contractor_id} href={toggleSel(Number(f.contractor_id))}
                className={sel.includes(Number(f.contractor_id)) ? "on" : ""}>
                {f.display_name.split(" ")[0]} {f.display_name.split(" ")[1]?.[0] ?? ""}.
              </Link>
            ))}
          </div>
        </section>

        {/* ── Barras por unidad: la tendencia de un vistazo ── */}
        <section className="plancha">
          <h2>Precio promedio por unidad <span className="mid">
            {multiUnidad ? "UNA ESCALA POR UNIDAD — NO SE MEZCLAN" : `TODO EN ${(unidades[0]?.[0] ?? "").toUpperCase()}`}</span></h2>
          {unidades.map(([unidad, fs]) => {
            const max = Math.max(...fs.map((f) => Number(f.precio_prom)));
            const prom = fs.reduce((s, f) => s + Number(f.precio_prom), 0) / fs.length;
            return (
              <div key={unidad} style={{ marginBottom: 18 }}>
                {multiUnidad && (
                  <div className="notaf" style={{ margin: "6px 0" }}>
                    POR {unidad.toUpperCase()} · {n0(fs.length)} CONTRATISTA{fs.length > 1 ? "S" : ""} ·
                    PROMEDIO {cop(Math.round(prom))}
                  </div>
                )}
                <div style={{ position: "relative" }}>
                  {fs.length > 1 && (
                    <div title={`promedio ${cop(Math.round(prom))}`} style={{
                      position: "absolute", top: 0, bottom: 0,
                      left: `calc(180px + (100% - 320px) * ${prom / max})`,
                      borderLeft: "2px dashed var(--tinta-3)", zIndex: 1 }} />
                  )}
                  {fs.map((f) => (
                    <div className="bar" key={f.contractor_id} style={{ position: "relative" }}>
                      <span className="lab" style={{ width: 172 }}>
                        <Link href={`/contratacion/contratistas/${f.contractor_id}`}>{f.display_name}</Link>
                      </span>
                      <div className="trk">
                        <div className="fil" style={{
                          width: `${(Number(f.precio_prom) / max) * 100}%`,
                          background: "var(--tinta-3)" }} />
                      </div>
                      <span className="val" style={{ width: 140 }}>
                        {cop(f.precio_prom)}
                        {f.eval_promedio != null && (
                          <span className={"sev " + (Number(f.eval_promedio) >= 4 ? "correcto" : "alerta")}
                            style={{ marginLeft: 6 }}>★{n1(f.eval_promedio)}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {filas.length === 0 && (
            <div className="vacio"><div className="t">Ningún contratista con la selección actual.</div>
              <div className="d"><Link href={link({ sel: "" })}>Quitar el filtro</Link></div></div>
          )}
        </section>

        {/* ── Detalle: qué cobró exactamente cada uno ── */}
        <section className="plancha">
          <h2>{grupo} <span className="mid">EXPANDE PARA VER LAS LÍNEAS REALES DE CADA UNO</span></h2>
          {filas.map((f) => (
            <details key={f.contractor_id} style={{ borderBottom: "1px solid var(--filete)" }}>
              <summary style={{ cursor: "pointer", listStyle: "none", padding: "10px 0",
                display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, minWidth: 200 }}>{f.display_name}</span>
                <span className="mono" style={{ fontFamily: "var(--fx-mono)", fontSize: 12 }}>
                  {cop(f.precio_prom)} / {f.unidad_comun ?? "—"}
                  {Number(f.unidades_distintas) > 1 ? ` (+${f.unidades_distintas - 1} unidades)` : ""}
                </span>
                <span className="notaf">{n0(f.lineas)} líneas · rango {cop(f.precio_min)}–{cop(f.precio_max)}</span>
                {f.vs_promedio_pct != null && (
                  <span className={"sev " + (Number(f.vs_promedio_pct) > 15 ? "alerta" : Number(f.vs_promedio_pct) < -15 ? "correcto" : "pendiente")}>
                    {Number(f.vs_promedio_pct) > 0 ? "+" : ""}{n1(f.vs_promedio_pct)} % vs prom.
                  </span>
                )}
                {f.rondas_prom != null && <span className="notaf">RONDAS {n1(f.rondas_prom)}</span>}
                {f.desviacion_prom != null && (
                  <span className="notaf">ENTREGA {f.desviacion_prom > 0 ? "+" : ""}{n1(f.desviacion_prom)} D</span>
                )}
                <span className="notaf" style={{ marginLeft: "auto" }}>▾ detalle</span>
              </summary>
              <div style={{ padding: "0 0 12px" }}>
                {(lineasPor[f.contractor_id] ?? []).map((l, i) => (
                  <div className="fila" key={i} style={{ display: "flex", gap: 12, padding: "6px 0 6px 16px",
                    fontSize: 13, alignItems: "baseline", borderBottom: "1px dotted var(--filete)" }}>
                    <span style={{ flex: 1 }}>{l.description}</span>
                    <span className="mono" style={{ fontFamily: "var(--fx-mono)", fontSize: 11, color: "var(--tinta-3)" }}>
                      {l.proyecto} · {fecha(l.due_date)}
                    </span>
                    <span className="mono" style={{ fontFamily: "var(--fx-mono)", fontSize: 12, whiteSpace: "nowrap" }}>
                      {n0(l.qty)} {l.unit ?? "u"} × {cop(l.unit_price)}
                    </span>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{cop(l.total)}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
          <p className="notaf" style={{ marginTop: 12 }}>
            EL ALCANCE EXACTO POR LÍNEA (SLIDES, MINUTOS, MÓDULOS) LLEGARÁ CON EL MÓDULO DE
            PRESUPUESTACIÓN Y SEGUIMIENTO DE PRODUCTO — AQUÍ SE CONECTARÁ DIRECTO
          </p>
        </section>
      </div>
    </>
  );
}
