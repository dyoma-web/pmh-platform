import Link from "next/link";
import { q } from "../../../lib/db";
import { cop, n0, n1 } from "../../../lib/fmt";
import Historia from "../../historia";

export const dynamic = "force-dynamic";

// Comparador por producto: quién cobra más caro/barato y cómo rinde.
// SOLO gestoras/administración — el portal jamás llega aquí.

export default async function Comparador({ searchParams }) {
  const sp = await searchParams;
  const grupos = await q(`
    select ihpsc_group, count(*) contratistas, sum(lineas) lineas,
           round(avg(precio_prom)) precio_grupo, sum(monto_total) monto
    from metrics.v2_comparador group by 1 order by monto desc`);
  const grupo = sp?.grupo || grupos[0]?.ihpsc_group || "";
  const filas = await q(
    `select * from metrics.v2_comparador where ihpsc_group = $1 order by precio_prom`, [grupo]);

  const barato = filas[0];
  const caro = filas.at(-1);
  const spread = barato && caro && Number(barato.precio_prom) > 0
    ? Number(caro.precio_prom) / Number(barato.precio_prom) : null;

  return (
    <>
      <Historia
        num="04"
        seccion="Contratación · Comparador"
        titulo={
          spread && filas.length > 1
            ? `En ${grupo.split("·")[0].trim().split(" ").slice(-2).join(" ")}, el más caro cobra ${n1(spread)}× lo del más barato`
            : "Comparador de contratistas por producto"
        }
        lede={`Precio promedio por línea de servicio real (no cotizaciones), cruzado con la evaluación interna, las rondas de ajustes y la desviación de entrega. Caro no significa malo: un ${n1(caro?.eval_promedio ?? 0) || "—"} en calidad puede justificar la diferencia — el punto es decidir con las dos variables a la vista, no con la memoria. Rondas y entrega son capturadas por la gestora al evaluar; serán dinámicas cuando la ejecución de proyectos alimente el dato.`}
        lado={<span className="notaf">SOLO INTERNO · FUENTE: LÍNEAS DE SERVICIO PROCESADAS</span>}
      />
      <div className="contenido">
        <section className="plancha">
          <div className="vercomo">
            <span className="notaf" style={{ marginRight: 6 }}>PRODUCTO</span>
            {grupos.map((g) => (
              <Link key={g.ihpsc_group}
                href={`/contratacion/comparador?grupo=${encodeURIComponent(g.ihpsc_group)}`}
                className={g.ihpsc_group === grupo ? "on" : ""}>
                {g.ihpsc_group.split("·")[0].trim()} ({g.contratistas})
              </Link>
            ))}
          </div>
        </section>

        <section className="plancha">
          <h2>{grupo || "Sin grupos"} <span className="mid">
            {n0(filas.length)} CONTRATISTAS · ORDENADO DEL MÁS BARATO AL MÁS CARO</span></h2>
          {filas.length === 0 ? (
            <div className="vacio"><div className="t">Este producto aún no tiene líneas comparables.</div></div>
          ) : (
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr><th>Contratista</th><th className="n">Líneas</th>
                    <th className="n">Precio prom.</th><th className="n">Rango</th>
                    <th className="n">vs promedio</th><th className="n">Eval.</th>
                    <th className="n">Rondas</th><th className="n">Entrega</th>
                    <th className="n">Monto total</th></tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.contractor_id}>
                      <td className={"estado " + (Number(f.vs_promedio_pct) <= 0 ? "correcto" : Number(f.vs_promedio_pct) > 15 ? "alerta" : "pendiente")}>
                        <Link href={`/contratacion/contratistas/${f.contractor_id}`}>{f.display_name}</Link>
                      </td>
                      <td className="n">{n0(f.lineas)}</td>
                      <td className="n" style={{ fontWeight: 600 }}>{cop(f.precio_prom)}</td>
                      <td className="n" style={{ fontSize: 12 }}>{cop(f.precio_min)} – {cop(f.precio_max)}</td>
                      <td className="n">
                        <span className={"sev " + (Number(f.vs_promedio_pct) > 15 ? "alerta" : Number(f.vs_promedio_pct) < -15 ? "correcto" : "pendiente")}>
                          {Number(f.vs_promedio_pct) > 0 ? "+" : ""}{n1(f.vs_promedio_pct)} %
                        </span>
                      </td>
                      <td className="n">{f.eval_promedio != null ? n1(f.eval_promedio) : "·"}</td>
                      <td className="n">{f.rondas_prom ?? "·"}</td>
                      <td className="n">{f.desviacion_prom != null ? `${f.desviacion_prom > 0 ? "+" : ""}${n1(f.desviacion_prom)} d` : "·"}</td>
                      <td className="n">{cop(f.monto_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="notaf" style={{ marginTop: 10 }}>
            · = sin evaluaciones aún — cada contrato que se cierre sin evaluar es una celda que se queda vacía
          </p>
        </section>
      </div>
    </>
  );
}
