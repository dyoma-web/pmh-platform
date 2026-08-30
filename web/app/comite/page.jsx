import { q } from "../../lib/db";
import { trmHoy } from "../../lib/trm";
import { cop, mcop, n0, n1, fecha, fechaHora } from "../../lib/fmt";
import ChartCaja from "../chart-caja";
import BotonImprimir from "./boton-imprimir";

export const dynamic = "force-dynamic";

// §15 del manual: una página, proyectable, imprimible en B/N. Se genera sola;
// nadie edita nada antes del comité. El vencido lleva barra sólida; el color
// nunca es el único portador de significado.

function proximoLunes() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
}

export default async function Comite() {
  const [k] = await q("select * from metrics.v2_kpis");
  const acciones = await q("select * from metrics.v2_acciones");
  const caja = await q("select * from metrics.v2_caja_13s");
  const aging = await q(`
    select cliente, sum(monto_cop) m, count(*) n from metrics.v2_cartera_resumen
    group by cliente order by m desc limit 6`);
  const dso = await q("select * from metrics.v2_dso_cliente order by monto_cop desc limit 2");
  const trm = await trmHoy();
  const pct = k.cartera_pendiente_cop ? (100 * k.cartera_vencida_cop) / k.cartera_pendiente_cop : 0;
  const lunes = proximoLunes();

  return (
    <div className="comite">
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", padding: "16px 0", gap: 12 }}>
        <span className="notaf">VISTA PREVIA — CTRL+P O EL BOTÓN GENERAN EL PDF</span>
        <BotonImprimir />
      </div>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        borderBottom: "2px solid var(--tinta-1)", paddingBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 17, letterSpacing: ".13em" }}>COTA</div>
          <div style={{ height: 2, width: 56, background: "var(--espectro)", margin: "4px 0" }} />
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", margin: "8px 0 0" }}>
            Comité de dirección
          </h1>
        </div>
        <div className="notaf" style={{ textAlign: "right", lineHeight: 1.8 }}>
          {["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"][0]} {fecha(lunes).toUpperCase()}<br />
          CORTE {fechaHora(k.corte).toUpperCase()}<br />
          VISTA CERTIFICADA v2{trm ? ` · TRM ${n1(trm)}` : ""}
          {k.ultimo_mes_sellado ? ` · SELLADO HASTA ${fecha(k.ultimo_mes_sellado).toUpperCase()}` : ""}
        </div>
      </header>

      <div className="kpis" style={{ margin: "18px 0", borderBottom: "1px solid var(--filete)", paddingBottom: 14 }}>
        <div className="kpi"><div className="et">Cartera vencida · M COP</div>
          <div className="v">{mcop(k.cartera_vencida_cop)}</div>
          <div className="ctx">{n1(pct)} % de {mcop(k.cartera_pendiente_cop)} M pendientes · {n0(k.hitos_vencidos)} hitos</div></div>
        <div className="kpi"><div className="et">Costo directo</div>
          <div className="v">{n1(k.costo_pct_completados)}<small>%</small></div>
          <div className="ctx">completados · fuente ledger</div></div>
        <div className="kpi"><div className="et">Backlog · M COP</div>
          <div className="v">{mcop(k.backlog_cop)}</div>
          <div className="ctx">adjudicado no facturado</div></div>
        <div className="kpi"><div className="et">Activos</div>
          <div className="v">{n0(k.proyectos_activos)}</div>
          <div className="ctx">{n0(k.activos_en_regularizacion)} en regularización</div></div>
        <div className="kpi"><div className="et">Pagos pendientes</div>
          <div className="v">{mcop(k.pagos_terceros_pend_cop)}<small>M</small></div>
          <div className="ctx">{n0(k.pagos_terceros_pend_n)} pagos · {n0(k.pagos_sin_soporte_n)} sin soporte</div></div>
        <div className="kpi"><div className="et">DSO ponderado</div>
          <div className="v">{n0(k.dso_ponderado_dias)}<small>d</small></div>
          <div className="ctx">{dso.map((d) => `${d.cliente} ${d.dso_dias}`).join(" · ")}</div></div>
      </div>

      <div className="g2" style={{ gap: 20 }}>
        <div>
          <h2 className="seccion-titulo">Cinco acciones de la semana</h2>
          <div className="acciones">
            {acciones.map((a, i) => (
              <div className="acc" key={i}>
                <div className="t">
                  {a.detalle}
                  <div className="quien">{a.dueno} · {a.project_code}</div>
                </div>
                <div className="m">{cop(a.monto_cop)}</div>
              </div>
            ))}
          </div>

          <h2 className="seccion-titulo" style={{ marginTop: 18 }}>Aging por cliente · M COP</h2>
          <div className="instr">
            {aging.map((a) => (
              <div className="fila" key={a.cliente}>
                <span className="lab">▌ {a.cliente}</span>
                <span className="mono">{n0(a.n)} hitos</span>
                <span className="val">{mcop(a.m)}</span>
              </div>
            ))}
            <div className="fila total">
              <span className="lab">TOTAL VENCIDO</span>
              <span className="val">{mcop(k.cartera_vencida_cop)}</span>
            </div>
          </div>
        </div>

        <div>
          <h2 className="seccion-titulo">Saldo semanal · 13 semanas · COP</h2>
          <ChartCaja data={caja} />
          <p style={{ fontSize: 11, color: "var(--tinta-2)", marginTop: 8 }}>
            Cobros con fecha probable (forecast) cuando existe; vencidos en la semana actual.
            Sin saldo inicial de caja ni costo fijo (parámetro pendiente, docs/05 M1).
          </p>
        </div>
      </div>

      <footer className="notaf" style={{ borderTop: "1px solid var(--filete)", marginTop: 20,
        paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
        <span>INNOVAHUB · DOCUMENTO INTERNO · GENERADO AUTOMÁTICAMENTE POR COTA</span>
        <span>1 / 1</span>
      </footer>
    </div>
  );
}
