import { q } from "../../lib/db";
import { cop, mcop, n0, n1, fecha } from "../../lib/fmt";
import Historia from "../historia";

export const dynamic = "force-dynamic";

export default async function Cartera() {
  const vencidos = await q(
    "select * from metrics.v0_cartera_aging order by expected_cop desc"
  );
  const [tot] = await q(
    "select count(*) n, sum(expected_cop) m from metrics.v0_cartera_aging"
  );
  const [top] = await q(`
    select cliente, partner_manager, sum(expected_cop) m, count(*) n
    from metrics.v0_cartera_aging group by 1,2 order by m desc limit 1`);
  const proximos = await q(`
    select i.project_code, p.partner_entity cliente, p.partner_manager,
           i.expected_date::date f, i.expected_cop, i.status
    from staging.income i join staging.projects p using (project_code)
    where i.status in ('Scheduled','Invoiced') and i.expected_date::date >= current_date
    order by i.expected_date limit 12`);

  const sevTramo = (d) => (d > 60 ? "critico" : d > 30 ? "alerta" : "pendiente");

  const pctTop = tot.m ? (100 * Number(top?.m ?? 0)) / Number(tot.m) : 0;
  return (
    <>
      <Historia
        num="03"
        seccion="Cartera y cobro"
        titulo={top ? `A ${top.cliente} hay que cobrarle primero` : "No hay cartera vencida"}
        lede={
          top
            ? `${top.cliente} debe ${mcop(top.m)} M de los ${mcop(tot.m)} M vencidos (${n1(
                pctTop
              )} %) en ${n0(top.n)} ${Number(top.n) === 1 ? "factura" : "facturas"} — responsable de la relación: ${
                top.partner_manager
              }. Cobrar lo demás son ${n0(Number(tot.n) - Number(top.n))} gestiones más, ordenadas abajo por monto: empieza por arriba.`
            : "Todos los hitos con fecha cumplida están acreditados."
        }
        lado={<span className="notaf">M5 · M6 · DUEÑO: PARTNER MANAGER</span>}
      />

      <div className="contenido">
        <section className="plancha">
          <h2>
            Hitos vencidos por monto <span className="mid">{n0(tot.n)} HITOS</span>
          </h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Código de proyecto</th>
                  <th>Cliente</th>
                  <th>Responsable</th>
                  <th>Estado</th>
                  <th className="n">Esperado</th>
                  <th className="n">Días</th>
                  <th className="n">Monto COP</th>
                </tr>
              </thead>
              <tbody>
                {vencidos.map((v) => (
                  <tr key={v.hito_id}>
                    <td className={"estado code " + sevTramo(v.dias_vencido)}>{v.project_code}</td>
                    <td>{v.cliente}</td>
                    <td>{v.partner_manager}</td>
                    <td>
                      <span className={"sev " + (v.status === "Invoiced" ? "alerta" : "pendiente")}>
                        {v.status === "Invoiced" ? "Facturado" : "Programado"}
                      </span>
                    </td>
                    <td className="n">{fecha(v.fecha_esperada)}</td>
                    <td className="n">{n0(v.dias_vencido)}</td>
                    <td className="n" style={{ fontWeight: 600 }}>{cop(v.expected_cop)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={6}>TOTAL VENCIDO · COP</td>
                  <td className="n">{cop(tot.m)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="plancha">
          <h2>
            Próximos hitos <span className="mid">12 SIGUIENTES POR FECHA</span>
          </h2>
          {proximos.length === 0 ? (
            <div className="vacio">
              <div className="t">No hay hitos futuros programados.</div>
              <div className="d">Todos los hitos registrados ya cumplieron su fecha esperada.</div>
            </div>
          ) : (
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr>
                    <th>Código de proyecto</th>
                    <th>Cliente</th>
                    <th>Responsable</th>
                    <th className="n">Fecha esperada</th>
                    <th className="n">Monto COP</th>
                  </tr>
                </thead>
                <tbody>
                  {proximos.map((h, i) => (
                    <tr key={i}>
                      <td className="estado info code">{h.project_code}</td>
                      <td>{h.cliente}</td>
                      <td>{h.partner_manager}</td>
                      <td className="n">{fecha(h.f)}</td>
                      <td className="n">{cop(h.expected_cop)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
