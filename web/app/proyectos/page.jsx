import Link from "next/link";
import { q } from "../../lib/db";
import { cop, mcop, n0, n1, fecha } from "../../lib/fmt";
import { slug } from "../../lib/slug";
import Historia from "../historia";

export const dynamic = "force-dynamic";

const ESTADOS = ["Todos", "active", "completed", "paused", "cancelled", "draft"];
const ES = { active: "Activo", completed: "Completado", paused: "Pausado",
  cancelled: "Cancelado", draft: "Borrador" };
const ORDENES = {
  semaforo: ["Por semáforo", `case semaforo when 'critico' then 1 when 'alerta' then 2
             when 'correcto' then 3 else 4 end, costeo_cop desc nulls last`],
  codigo: ["Alfabético (código)", "project_code asc"],
  cliente: ["Por cliente", "cliente asc nulls last, costeo_cop desc nulls last"],
  gestora: ["Por gestora", "gestora asc nulls last, costeo_cop desc nulls last"],
  pais: ["Por país", "pais asc nulls last, costeo_cop desc nulls last"],
  costeo: ["Mayor costeo", "costeo_cop desc nulls last"],
};

export default async function Proyectos({ searchParams }) {
  const sp = await searchParams;
  const estado = sp?.estado && sp.estado !== "Todos" ? sp.estado : null;
  const buscar = (sp?.q || "").trim();
  const orden = ORDENES[sp?.orden] ? sp.orden : "semaforo";
  const fCliente = sp?.cliente || "";
  const fGestora = sp?.gestora || "";
  const fPais = sp?.pais || "";
  const fLinea = sp?.linea || "";

  const [opciones] = await q(`
    select array_agg(distinct cliente) filter (where cliente is not null) clientes,
           array_agg(distinct gestora) filter (where gestora is not null) gestoras,
           array_agg(distinct pais) filter (where pais is not null) paises,
           array_agg(distinct linea) filter (where linea is not null) lineas
    from metrics.v2_portafolio`);

  const filas = await q(
    `select * from metrics.v2_portafolio
     where ($1::text is null or estado = $1)
       and ($2 = '' or project_code ilike '%'||$2||'%' or cliente ilike '%'||$2||'%'
            or gestora ilike '%'||$2||'%' or pais ilike '%'||$2||'%')
       and ($3 = '' or cliente = $3)
       and ($4 = '' or gestora = $4)
       and ($5 = '' or pais = $5)
       and ($6 = '' or linea = $6)
     order by ${ORDENES[orden][1]}`,
    [estado, buscar, fCliente, fGestora, fPais, fLinea]
  );
  const totCosteo = filas.reduce((s, f) => s + Number(f.costeo_cop || 0), 0);
  const criticos = filas.filter((f) => f.semaforo === "critico").length;
  const regularizar = filas.filter((f) => f.semaforo === "alerta").length;
  const hayFiltro = fCliente || fGestora || fPais || fLinea || buscar;

  const titulo = hayFiltro
    ? `${n0(filas.length)} proyectos con este filtro`
    : criticos > 0
      ? `${n0(criticos)} proyectos piden atención antes que los demás`
      : `${n0(filas.length)} proyectos, ninguno en rojo`;
  const lede = hayFiltro
    ? `Filtro activo${fCliente ? ` · cliente ${fCliente}` : ""}${fGestora ? ` · gestora ${fGestora}` : ""}${fPais ? ` · país ${fPais}` : ""}${fLinea ? ` · línea ${fLinea}` : ""}${buscar ? ` · «${buscar}»` : ""}. Costeo del conjunto: ${mcop(totCosteo)} M COP. Orden: ${ORDENES[orden][0].toLowerCase()}.`
    : `Los de arriba tienen saldos vencidos por cobrar; les siguen ${n0(regularizar)} con fecha de cierre cumplida. Ordena y filtra por cliente, gestora, país o línea — y los agregados de cada dimensión viven en Resúmenes. Costeo visible: ${mcop(totCosteo)} M COP.`;

  const sel = { height: 40, border: "1px solid var(--filete)", borderRadius: 8,
    padding: "0 10px", fontFamily: "var(--fx-archivo)", fontSize: 13,
    background: "var(--plancha)", color: "var(--tinta-1)" };

  return (
    <>
      <Historia num="03" seccion="Proyectos · Portafolio" titulo={titulo} lede={lede}
        lado={
          <>
            <Link className="btn sec" href="/proyectos/resumen">Resúmenes</Link>
            <Link className="btn" href="/proyectos/nuevo">Nuevo proyecto</Link>
          </>
        } />

      <div className="contenido">
        <section className="plancha">
          <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <input name="q" defaultValue={buscar} placeholder="Buscar texto libre"
              style={{ ...sel, flex: "1 1 180px", padding: "0 14px" }} />
            <select name="cliente" defaultValue={fCliente} style={sel}>
              <option value="">Cliente: todos</option>
              {(opciones.clientes ?? []).sort().map((c) => <option key={c}>{c}</option>)}
            </select>
            <select name="gestora" defaultValue={fGestora} style={sel}>
              <option value="">Gestora: todas</option>
              {(opciones.gestoras ?? []).sort().map((g) => <option key={g}>{g}</option>)}
            </select>
            <select name="pais" defaultValue={fPais} style={sel}>
              <option value="">País: todos</option>
              {(opciones.paises ?? []).sort().map((p) => <option key={p}>{p}</option>)}
            </select>
            <select name="linea" defaultValue={fLinea} style={sel}>
              <option value="">Línea: todas</option>
              {(opciones.lineas ?? []).sort().map((l) => <option key={l}>{l}</option>)}
            </select>
            <select name="estado" defaultValue={sp?.estado ?? "active"} style={sel}>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>{e === "Todos" ? "Todos los estados" : ES[e]}</option>
              ))}
            </select>
            <select name="orden" defaultValue={orden} style={sel}>
              {Object.entries(ORDENES).map(([k, [lbl]]) => <option key={k} value={k}>{lbl}</option>)}
            </select>
            <button className="btn" type="submit">Aplicar</button>
            {hayFiltro && <Link className="btn sec" href="/proyectos"
              style={{ alignSelf: "center" }}>Limpiar</Link>}
          </form>

          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Código de proyecto</th>
                  <th>Cliente</th>
                  <th>País</th>
                  <th>Línea</th>
                  <th>Gestora</th>
                  <th>Estado</th>
                  <th className="n">Costeo COP</th>
                  <th className="n">Ejec. %</th>
                  <th className="n">Próx. hito</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.project_code}>
                    <td className={"estado code " + f.semaforo}>
                      <Link href={`/proyectos/${encodeURIComponent(f.project_code)}`}>
                        {f.display_code}
                      </Link>
                    </td>
                    <td>{f.cliente ?? "—"}</td>
                    <td>
                      {f.pais && (
                        <img src={`/img/banderas/${slug(f.pais)}.png`} alt=""
                          width={18} height={13}
                          style={{ verticalAlign: "-1px", marginRight: 6, borderRadius: 2 }} />
                      )}
                      {f.pais ?? "—"}
                    </td>
                    <td className="code">{f.linea ?? "—"}</td>
                    <td>{f.gestora ?? "—"}</td>
                    <td>
                      <span className={"sev " + f.semaforo}>
                        {f.vencidos_n > 0
                          ? `${f.vencidos_n} venc.`
                          : f.semaforo === "alerta"
                            ? "regularizar"
                            : ES[f.estado] ?? f.estado}
                      </span>
                    </td>
                    <td className="n">{f.costeo_cop ? cop(f.costeo_cop) : "—"}</td>
                    <td className="n">{f.ejec_pct == null ? "—" : n1(f.ejec_pct)}</td>
                    <td className="n">{f.prox_hito ? fecha(f.prox_hito) : "—"}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={6}>TOTAL {n0(filas.length)} FILAS · COP</td>
                  <td className="n">{cop(totCosteo)}</td>
                  <td className="n" colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
          {filas.length === 0 && (
            <div className="vacio">
              <div className="t">Ningún proyecto coincide con este filtro.</div>
              <div className="d"><Link href="/proyectos">Limpiar los filtros</Link></div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
