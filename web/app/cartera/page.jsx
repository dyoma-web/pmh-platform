import { q } from "../../lib/db";
import { cop, mcop, n0, fecha } from "../../lib/fmt";

export const dynamic = "force-dynamic";

export default async function Cartera() {
  const vencidos = await q(
    "select * from metrics.v0_cartera_aging order by expected_cop desc"
  );
  const [tot] = await q(
    "select count(*) n, sum(expected_cop) m from metrics.v0_cartera_aging"
  );
  const proximos = await q(`
    select i.project_code, p.partner_entity cliente, p.partner_manager,
           i.expected_date::date f, i.expected_cop, i.status
    from staging.income i join staging.projects p using (project_code)
    where i.status in ('Scheduled','Invoiced') and i.expected_date::date >= current_date
    order by i.expected_date limit 12`);

  const sevTramo = (d) => (d > 60 ? "critico" : d > 30 ? "alerta" : "pendiente");

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Cartera y cobro</h1>
          <div className="sub">
            {cop(tot.m)} COP vencidos · {n0(tot.n)} hitos
          </div>
        </div>
        <div className="meta">M5 · M6 · dueño: partner manager</div>
      </div>

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
