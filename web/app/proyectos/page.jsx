import Link from "next/link";
import { q } from "../../lib/db";
import { cop, mcop, n0, n1, fecha } from "../../lib/fmt";

export const dynamic = "force-dynamic";

const ESTADOS = ["Todos", "Active", "Completed", "Paused", "Cancelled"];
const ES = { Active: "Activo", Completed: "Completado", Paused: "Pausado", Cancelled: "Cancelado" };

export default async function Proyectos({ searchParams }) {
  const sp = await searchParams;
  const estado = sp?.estado && sp.estado !== "Todos" ? sp.estado : null;
  const buscar = (sp?.q || "").trim();

  const filas = await q(
    `select * from metrics.v0_portafolio
     where ($1::text is null or estado = $1)
       and ($2 = '' or project_code ilike '%'||$2||'%' or cliente ilike '%'||$2||'%'
            or gestora ilike '%'||$2||'%' or pais ilike '%'||$2||'%')
     order by case semaforo when 'critico' then 1 when 'alerta' then 2
              when 'correcto' then 3 else 4 end, costeo_cop desc nulls last`,
    [estado, buscar]
  );
  const totCosteo = filas.reduce((s, f) => s + Number(f.costeo_cop || 0), 0);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Portafolio</h1>
          <div className="sub">
            {n0(filas.length)} proyectos{estado ? ` en estado ${ES[estado] ?? estado}` : ""} ·
            ordenados por semáforo
          </div>
        </div>
        <div className="meta">costeo total {mcop(totCosteo)} M COP</div>
      </div>

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
              name="estado" defaultValue={sp?.estado ?? "Active"}
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
                        {f.project_code}
                      </Link>
                    </td>
                    <td>{f.cliente}</td>
                    <td>{f.pais}</td>
                    <td className="code">{f.linea}</td>
                    <td>{f.gestora}</td>
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
              <div className="d">Hay 144 proyectos en el maestro. Quita el texto o cambia el estado.</div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
