import { q } from "../lib/db";
import { cop, mcop, n0, n1, fecha } from "../lib/fmt";
import ChartCaja from "./chart-caja";

export const dynamic = "force-dynamic";

export default async function Cockpit() {
  const [k] = await q("select * from metrics.v0_kpis");
  const caja = await q("select * from metrics.v0_caja_13s");
  const acciones = await q("select * from metrics.v0_acciones");
  const duenos = await q("select * from metrics.v0_semaforos_dueno limit 6");
  const margen = await q("select * from metrics.v0_margen_linea");
  const aging = await q(`
    select cliente, tramo, sum(monto_cop) m from metrics.v0_cartera_resumen
    group by cliente, tramo`);
  const dso = await q("select * from metrics.v0_dso_cliente order by monto_cop desc");

  const pctVencida = k.cartera_pendiente_cop
    ? (100 * k.cartera_vencida_cop) / k.cartera_pendiente_cop
    : 0;

  // matriz aging cliente × tramo
  const TRAMOS = ["01-30", "31-60", "61-90", "+90"];
  const porCliente = {};
  for (const r of aging) {
    porCliente[r.cliente] ??= { cliente: r.cliente, total: 0 };
    porCliente[r.cliente][r.tramo] = Number(r.m);
    porCliente[r.cliente].total += Number(r.m);
  }
  const clientes = Object.values(porCliente).sort((a, b) => b.total - a.total);
  const dsoMap = Object.fromEntries(dso.map((d) => [d.cliente, d.dso_dias]));

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Cockpit</h1>
          <div className="sub">La misma verdad para el comité del lunes.</div>
        </div>
        <div className="meta">Vista certificada v0 · M1–M12 en construcción</div>
      </div>

      <div className="contenido">
        {/* Cifra que manda (plancha cartográfica 14B) */}
        <section className="plancha">
          <div className="manda">
            <div>
              <div className="cifra">{mcop(k.cartera_vencida_cop)}</div>
              <div className="notaf" style={{ marginTop: 8 }}>
                millones COP vencidos · M5
              </div>
            </div>
            <div className="quee">
              <div className="t1">
                {n1(pctVencida)} % de {mcop(k.cartera_pendiente_cop)} M en cartera pendiente
              </div>
              <div className="t2">
                {n0(k.hitos_vencidos)} hitos de cobro con fecha esperada cumplida y sin acreditar.
                Es la cifra que ordena la semana.
              </div>
            </div>
          </div>
        </section>

        {/* Fila de KPI: casillas de un instrumento */}
        <section className="plancha">
          <div className="kpis">
            <div className="kpi">
              <div className="et">Cartera pendiente</div>
              <div className="v">
                {mcop(k.cartera_pendiente_cop)}
                <small>M COP</small>
              </div>
              <div className="ctx">vencida {mcop(k.cartera_vencida_cop)} M · {n1(pctVencida)} %</div>
              <div className="mid">M5</div>
            </div>
            <div className="kpi">
              <div className="et">Costo directo</div>
              <div className="v alerta">
                {n1(k.costo_pct_completados)}
                <small>%</small>
              </div>
              <div className="ctx">sobre acreditado · proyectos completados</div>
              <div className="mid">M2 (aprox)</div>
            </div>
            <div className="kpi">
              <div className="et">Activos</div>
              <div className="v">{n0(k.proyectos_activos)}</div>
              <div className="ctx">{n0(k.activos_en_regularizacion)} en regularización</div>
              <div className="mid">—</div>
            </div>
            <div className="kpi">
              <div className="et">Backlog</div>
              <div className="v">
                {mcop(k.backlog_cop)}
                <small>M COP</small>
              </div>
              <div className="ctx">adjudicado no facturado · activos</div>
              <div className="mid">M7</div>
            </div>
            <div className="kpi">
              <div className="et">Pagos a terceros</div>
              <div className="v">
                {mcop(k.pagos_terceros_pend_cop)}
                <small>M COP</small>
              </div>
              <div className="ctx">
                {n0(k.pagos_terceros_pend_n)} pendientes · {n0(k.pagos_sin_soporte_n)} sin soporte
              </div>
              <div className="mid">M8</div>
            </div>
            <div className="kpi">
              <div className="et">DSO ponderado</div>
              <div className="v">
                {n0(k.dso_ponderado_dias)}
                <small>días</small>
              </div>
              <div className="ctx">12 meses móviles</div>
              <div className="mid">M6</div>
            </div>
          </div>
        </section>

        <section className="plancha">
          <h2>
            Caja proyectada · 13 semanas{" "}
            <span className="mid">M1 (APROX) · COBROS NO COBRADOS VS PAGOS NO PAGADOS · COP</span>
          </h2>
          <ChartCaja data={caja} />
          <p style={{ fontSize: 12, color: "var(--tinta-2)", margin: "10px 0 0" }}>
            Los hitos y pagos ya vencidos caen en la semana actual (criterio conservador). En F2 la
            probabilidad de cobro por cliente refinará esta curva.
          </p>
        </section>

        <div className="g32">
          {/* Cinco acciones */}
          <section className="plancha">
            <h2>
              Cinco acciones de la semana <span className="mid">POR MONTO VENCIDO</span>
            </h2>
            <div className="acciones">
              {acciones.map((a) => (
                <div className="acc" key={a.regla + a.referencia}>
                  <div className="t">
                    {a.regla === "hito_vencido" ? "Gestión de cobro" : "Pago a contratista vencido"}{" "}
                    · <span className="code" style={{ fontFamily: "var(--fx-mono)", fontSize: 12 }}>{a.project_code}</span>
                    <div className="quien">
                      {a.dueno} · {n0(a.dias)} días
                    </div>
                  </div>
                  <div className="m">{cop(a.monto_cop)}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Semáforos por dueño */}
          <section className="plancha">
            <h2>
              Semáforos abiertos por dueño <span className="mid">ANTIGÜEDAD MÁX · N.º</span>
            </h2>
            <div className="instr">
              {duenos.map((d) => (
                <div className="fila" key={d.dueno}>
                  <span className="lab">{d.dueno}</span>
                  <span className="mono">{d.antiguedad_max ?? "—"} d</span>
                  <span className="val">{n0(d.abiertos)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="g2">
          {/* Aging matriz */}
          <section className="plancha">
            <h2>
              Aging de cartera por cliente <span className="mid">M5 · COP</span>
            </h2>
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    {TRAMOS.map((t) => (
                      <th key={t} className="n">{t}</th>
                    ))}
                    <th className="n">Vencido</th>
                    <th className="n">DSO</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => (
                    <tr key={c.cliente}>
                      <td className="estado critico">{c.cliente}</td>
                      {TRAMOS.map((t) => (
                        <td key={t} className="n">{c[t] ? mcop(c[t]) : "·"}</td>
                      ))}
                      <td className="n" style={{ fontWeight: 600 }}>{mcop(c.total)}</td>
                      <td className="n">{dsoMap[c.cliente] ?? "—"}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>TOTAL · M COP</td>
                    {TRAMOS.map((t) => (
                      <td key={t} className="n">
                        {mcop(clientes.reduce((s, c) => s + (c[t] || 0), 0))}
                      </td>
                    ))}
                    <td className="n">{mcop(clientes.reduce((s, c) => s + c.total, 0))}</td>
                    <td className="n">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Margen por línea */}
          <section className="plancha">
            <h2>
              Costo directo por línea <span className="mid">COMPLETADOS · % DEL ACREDITADO</span>
            </h2>
            <div className="instr">
              {margen.map((m) => (
                <div className="fila" key={m.service_line}>
                  <span className="lab">
                    {m.service_line}
                    <span className="mono" style={{ marginLeft: 8 }}>{m.proyectos} proy.</span>
                  </span>
                  <span className="mono">{mcop(m.acreditado_cop)} M acred.</span>
                  <span className="val">{m.costo_pct == null ? "—" : n1(m.costo_pct) + " %"}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--tinta-2)", marginBottom: 0 }}>
              Incluye trabajo interno causado a proyecto. Costos contables desde ene 2024:
              los proyectos 2022–2023 aparecen sin costo.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
