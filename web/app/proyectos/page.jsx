import Link from "next/link";
import { q } from "../../lib/db";
import { cop, mcop, n0, n1, fecha } from "../../lib/fmt";
import { slug } from "../../lib/slug";
import Historia from "../historia";

export const dynamic = "force-dynamic";

const ESTADOS = ["Todos", "active", "completed", "paused", "cancelled", "draft"];
const ES = { active: "Activo", completed: "Completado", paused: "Pausado",
  cancelled: "Cancelado", draft: "Borrador" };

export default async function Proyectos({ searchParams }) {
  const sp = await searchParams;
  const estado = sp?.estado && sp.estado !== "Todos" ? sp.estado : null;
  const buscar = (sp?.q || "").trim();

  const filas = await q(
    `select * from metrics.v2_portafolio
     where ($1::text is null or estado = $1)
       and ($2 = '' or project_code ilike '%'||$2||'%' or cliente ilike '%'||$2||'%'
            or gestora ilike '%'||$2||'%' or pais ilike '%'||$2||'%')
     order by case semaforo when 'critico' then 1 when 'alerta' then 2
              when 'correcto' then 3 else 4 end, costeo_cop desc nulls last`,
    [estado, buscar]
  );
  const totCosteo = filas.reduce((s, f) => s + Number(f.costeo_cop || 0), 0);
  const criticos = filas.filter((f) => f.semaforo === "critico").length;
  const regularizar = filas.filter((f) => f.semaforo === "alerta").length;
  const titulo = buscar
    ? `${n0(filas.length)} resultados para «${buscar}»`
    : criticos > 0
      ? `${n0(criticos)} proyectos piden atención antes que los demás`
      : `${n0(filas.length)} proyectos, ninguno en rojo`;
  const lede = buscar
    ? `Filtrando ${estado ? (ES[estado] ?? estado).toLowerCase() + "s" : "todo el portafolio"} por «${buscar}». El orden sigue siendo por semáforo: lo urgente arriba.`
    : `Los de arriba tienen saldos vencidos por cobrar; les siguen ${n0(regularizar)} con fecha de cierre cumplida que exigen prórroga o cierre. Fuente: núcleo transaccional (los saldos descuentan abonos parciales). Costeo visible: ${mcop(totCosteo)} M COP.`;

  return (
    <>
      <Historia num="02" seccion="Proyectos · Portafolio" titulo={titulo} lede={lede}
        lado={
          <>
            <span className="notaf">{n0(filas.length)} FILAS · FUENTE TRANSACCIONAL</span>
            <Link className="btn" href="/proyectos/nuevo">Nuevo proyecto</Link>
          </>
        } />

      <div className="contenido">
        <section className="plancha">
          <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <input
              name="q" defaultValue={buscar}
              placeholder="Proyecto, cliente, gestora o país"
              style={{
                flex: "1 1 260px", height: 40, border: "1px solid var(--filete)",
                borderRadius: 8, padding: "0 14px", fontFamily: "var(--fx-archivo)",
                fontSize: 13, background: "var(--plancha)", color: "var(--tinta-1)",
              }}
            />
            <select
              name="estado" defaultValue={sp?.estado ?? "active"}
              style={{
                height: 40, border: "1px solid var(--filete)", borderRadius: 8,
                padding: "0 10px", fontFamily: "var(--fx-archivo)", fontSize: 13,
                background: "var(--plancha)", color: "var(--tinta-1)",
              }}
            >
              {ESTADOS.map((e) => (
                <option key={e} value={e}>{e === "Todos" ? "Todos los estados" : ES[e]}</option>
              ))}
            </select>
            <button className="btn" type="submit">Filtrar portafolio</button>
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
              <div className="d">Quita el texto o cambia el estado.</div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
