import { q } from "../../lib/db";
import { n0, fecha } from "../../lib/fmt";
import Historia from "../historia";
import Asignador from "./asignador";

export const dynamic = "force-dynamic";

function lunes(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d.toISOString().slice(0, 10);
}

export default async function Capacidad() {
  const semanas = Array.from({ length: 8 }, (_, i) => lunes(i));
  const usuarios = await q(`
    select id, full_name from core.app_user
    where active and email is not null and ih_role like '%Project Manager%'
    order by full_name`);
  const proyectos = await q(`
    select code, display_code from core.project
    where kind in ('project','phase') and status in ('active','draft','paused') order by code`);
  const celdas = await q(`
    select a.user_id, a.week::text week, sum(a.dedication_pct) pct,
           count(distinct a.project_id) proys
    from core.assignment a
    where a.week >= $1::date group by 1, 2`, [semanas[0]]);
  const mapa = {};
  for (const c of celdas) mapa[`${c.user_id}|${c.week}`] = c;
  const sobrecargados = celdas.filter((c) => Number(c.pct) > 100).length;
  const sinDatos = celdas.length === 0;

  return (
    <>
      <Historia
        num="10"
        seccion="Capacidad del equipo"
        titulo={
          sinDatos
            ? "¿Puedes aceptar el proyecto del jueves? Aún no se sabe"
            : sobrecargados > 0
              ? `${n0(sobrecargados)} semanas-persona en sobrecarga`
              : "Capacidad bajo control en las próximas 8 semanas"
        }
        lede={`Dedicación por persona y semana en porcentaje — sin horas: 5 minutos de captura semanal bastan. Con esto, «¿aceptamos este proyecto?» deja de responderse por intuición: se mira quién tiene espacio en la ventana de ejecución. Más de 100 % en una semana se marca en rojo, no se prohíbe: la sobrecarga consciente es una decisión, la invisible es un riesgo.`}
        lado={<span className="notaf">CAPTURA: GESTORA O ADMINISTRACIÓN</span>}
      />
      <div className="contenido">
        <Asignador usuarios={usuarios} proyectos={proyectos} semanas={semanas} />

        <section className="plancha">
          <h2>Dedicación por persona <span className="mid">PRÓXIMAS 8 SEMANAS · % COMPROMETIDO</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Persona</th>
                  {semanas.map((s) => (
                    <th key={s} className="n">{fecha(s).slice(0, 6)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td className="estado pendiente">{u.full_name}</td>
                    {semanas.map((s) => {
                      const c = mapa[`${u.id}|${s}`];
                      const pct = c ? Number(c.pct) : 0;
                      const sev = pct > 100 ? "critico" : pct >= 80 ? "alerta" : pct > 0 ? "correcto" : "pendiente";
                      return (
                        <td key={s} className="n">
                          <span className={"sev " + sev} style={{ fontSize: 12 }}>
                            {pct > 0 ? n0(pct) + "%" : "·"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="notaf" style={{ marginTop: 10 }}>
            · = sin dedicación registrada — que una celda vacía signifique «libre» exige que el equipo capture; hasta entonces significa «no se sabe»
          </p>
        </section>
      </div>
    </>
  );
}
