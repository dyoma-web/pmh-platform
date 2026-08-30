import { cop } from "../lib/fmt";
import { MES3, fechaCorta } from "../lib/cal";

// Línea de vida: carriles por familia, eje de tiempo, cada evento con plan y
// real dibujados en pareja (hueco = previsto, sólido = ocurrido) unidos por un
// segmento cuya longitud es la desviación. El color es semántico (vencido) y
// nunca el único portador: la forma distingue familia y el relleno, plan/real.
// Recibe filas de metrics.v2_eventos con fp/fr/ff como YYYY-MM-DD.

const DAY = 86400000;
const t = (s) => (s ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null);
const colorDe = (e) => e.estado === "vencido" ? "var(--critico)" : e.estado === "cumplido" ? "var(--tinta-1)"
  : e.estado === "anulado" ? "var(--pendiente)" : "var(--tinta-3)";

function Marca({ familia, x, y, solido, color, dash, r = 5.5 }) {
  const fill = solido ? color : "var(--plancha)";
  const common = { fill, stroke: color, strokeWidth: 1.6, strokeDasharray: dash ? "2 2" : undefined };
  if (familia === "dinero") return <path d={`M${x - r},${y - r} L${x + r},${y - r} L${x},${y + r} Z`} {...common} />;
  if (familia === "entrega") return <circle cx={x} cy={y} r={r} {...common} />;
  if (familia === "novedad") return <path d={`M${x},${y - r - 1} L${x + r + 1},${y} L${x},${y + r + 1} L${x - r - 1},${y} Z`} {...common} />;
  return <path d={`M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`} {...common} />;
}

export default function LineaVida({ eventos, carriles, fantasmas = [], titulo = "Línea de vida", hoyStr }) {
  const hoy = t(hoyStr || new Date().toISOString().slice(0, 10));
  const ts = [];
  for (const e of eventos) for (const s of [e.fp, e.fr, e.ff]) if (s) ts.push(t(s));
  for (const f of fantasmas) if (f?.fecha) ts.push(t(f.fecha));
  if (ts.length === 0) {
    return <div className="vacio"><div className="t">Sin fechas registradas.</div>
      <div className="d">La línea se dibuja sola a medida que se capturan firmas, pagos y entregas.</div></div>;
  }
  let min = Math.min(...ts, hoy), max = Math.max(...ts, hoy);
  const pad = Math.max((max - min) * 0.05, 10 * DAY);
  min -= pad; max += pad;

  const W = 1000, L = 112, R = 20, laneH = 36, top = 30;
  const lanes = carriles.map((c) => ({ ...c, ev: eventos.filter(c.filtro) })).filter((c) => c.ev.length > 0);
  const H = top + lanes.length * laneH + 24;
  const x = (tt) => L + ((tt - min) / (max - min)) * (W - L - R);

  const ticks = [];
  {
    const d0 = new Date(min);
    let d = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
    const span = (max - min) / DAY;
    const cada = span > 900 ? 6 : span > 420 ? 3 : span > 200 ? 2 : 1;
    while (d < max) {
      const dd = new Date(d);
      if (dd.getUTCMonth() % cada === 0) ticks.push(d);
      d = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + 1, 1);
    }
  }

  const crono = [...eventos].filter((e) => e.tipo !== "vigencia" && (e.fp || e.fr))
    .sort((a, b) => ((a.fr || a.fp) < (b.fr || b.fp) ? -1 : 1));

  return (
    <div>
      <div className="lv-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="lv" role="img" aria-label={titulo}>
          {ticks.map((tk) => {
            const d = new Date(tk);
            return (
              <g key={tk}>
                <line x1={x(tk)} x2={x(tk)} y1={top - 10} y2={H - 16} stroke="var(--filete)" />
                <text x={x(tk) + 3} y={top - 14} className="lv-tick">
                  {MES3[d.getUTCMonth()].toUpperCase()} {String(d.getUTCFullYear()).slice(2)}
                </text>
              </g>
            );
          })}
          {lanes.map((c, i) => {
            const y = top + i * laneH + laneH / 2;
            return (
              <g key={c.id}>
                <text x={0} y={y + 4} className="lv-lab">{c.label}</text>
                <line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--surco)" />
                {c.ev.map((e, j) => {
                  const color = colorDe(e);
                  if (e.tipo === "vigencia" && e.fp && e.ff) {
                    const x1 = x(t(e.fp)), x2 = x(t(e.ff));
                    return (
                      <g key={j}>
                        <rect x={x1} y={y - 5} width={Math.max(x2 - x1, 2)} height={10} rx={2}
                          fill={e.estado === "anulado" ? "var(--plancha)" : "var(--surco)"} stroke={color}
                          strokeDasharray={e.estado === "anulado" ? "3 3" : undefined} />
                        <title>{`${e.titulo}: ${fechaCorta(e.fp)} → ${fechaCorta(e.ff)}`}</title>
                      </g>
                    );
                  }
                  const xp = e.fp ? x(t(e.fp)) : null, xr = e.fr ? x(t(e.fr)) : null;
                  const desv = e.fp && e.fr ? Math.round((t(e.fr) - t(e.fp)) / DAY) : null;
                  const tip = `${e.titulo}\nprevisto ${e.fp ? fechaCorta(e.fp) : "—"} · ocurrió ${e.fr ? fechaCorta(e.fr) : "—"}` +
                    `${desv != null ? ` · desviación ${desv > 0 ? "+" : ""}${desv} d` : ""}` +
                    `${e.monto_cop ? ` · ${cop(e.monto_cop)}` : ""} · ${e.estado.replace("_", " ")}`;
                  return (
                    <g key={j}>
                      <title>{tip}</title>
                      {xp != null && xr != null && Math.abs(xr - xp) > 1 && (
                        <line x1={xp} x2={xr} y1={y} y2={y} stroke={color} strokeWidth={2}
                          strokeDasharray={desv > 0 ? "3 2" : undefined} />
                      )}
                      {xp != null && <Marca familia={e.familia} x={xp} y={y} solido={false} color={color}
                        dash={e.estado === "no_registrado"} />}
                      {xr != null && <Marca familia={e.familia} x={xr} y={y} solido color={color} />}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {fantasmas.map((f, i) => f?.fecha && (
            <g key={"f" + i}>
              <title>{f.titulo || "Fecha anterior"}</title>
              <Marca familia="acto" x={x(t(f.fecha))} y={top + laneH / 2} solido={false} color="var(--pendiente)" dash />
            </g>
          ))}
          <line x1={x(hoy)} x2={x(hoy)} y1={top - 10} y2={H - 16} stroke="var(--acento)" strokeDasharray="4 3" strokeWidth={1.5} />
          <text x={x(hoy) + 4} y={H - 4} className="lv-tick" style={{ fill: "var(--acento)" }}>HOY</text>
        </svg>
      </div>
      <div className="lv-leyenda">
        ◇ ACTO · ▽ DINERO · ○ ENTREGA · ◈ NOVEDAD — HUECO = PREVISTO · SÓLIDO = OCURRIDO · SEGMENTO = DESVIACIÓN
        · PUNTEADO = NO REGISTRADO · ROJO = VENCIDO
      </div>
      {crono.length > 0 && (
        <details className="lv-crono">
          <summary>VER CRONOLOGÍA ({crono.length})</summary>
          <div className="twrap">
            <table className="maestra" style={{ marginTop: 8 }}>
              <thead><tr><th>Evento</th><th>Previsto</th><th>Ocurrió</th><th className="n">Desv.</th>
                <th className="n">Monto</th><th>Estado</th><th>Dueño</th></tr></thead>
              <tbody>
                {crono.map((e, i) => {
                  const desv = e.fp && e.fr ? Math.round((t(e.fr) - t(e.fp)) / DAY) : null;
                  return (
                    <tr key={i}>
                      <td className={"estado " + (e.estado === "vencido" ? "critico" : e.estado === "cumplido" ? "correcto" : e.estado === "anulado" ? "pendiente" : "info")}>{e.titulo}</td>
                      <td className="code">{e.fp ? fechaCorta(e.fp) + " " + e.fp.slice(2, 4) : "—"}</td>
                      <td className="code">{e.fr ? fechaCorta(e.fr) + " " + e.fr.slice(2, 4) : "—"}</td>
                      <td className={"n code " + (desv > 0 ? "sev alerta" : "")}>{desv != null ? `${desv > 0 ? "+" : ""}${desv} d` : "·"}</td>
                      <td className="n">{e.monto_cop ? cop(e.monto_cop) : "·"}</td>
                      <td><span className={"sev " + (e.estado === "vencido" ? "critico" : e.estado === "cumplido" ? "correcto" : "pendiente")}>{e.estado.replace("_", " ")}</span></td>
                      <td style={{ fontSize: 12 }}>{e.dueno}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// Carriles estándar
export const CARRILES_CONTRATO = [
  { id: "actos", label: "ACTOS", filtro: (e) => e.familia === "acto" },
  { id: "dinero", label: "DINERO", filtro: (e) => e.familia === "dinero" },
  { id: "entregas", label: "ENTREGAS", filtro: (e) => e.familia === "entrega" },
  { id: "novedades", label: "NOVEDADES", filtro: (e) => e.familia === "novedad" },
];
export const CARRILES_PROYECTO = [
  { id: "proyecto", label: "PROYECTO", filtro: (e) => e.ambito === "proyecto" && e.familia === "acto" },
  { id: "ingresos", label: "INGRESOS", filtro: (e) => e.ambito === "proyecto" && e.familia === "dinero" },
  { id: "contratos", label: "CONTRATOS", filtro: (e) => e.ambito === "contrato" && e.familia === "acto" && e.tipo !== "vigencia" },
  { id: "egresos", label: "EGRESOS", filtro: (e) => e.ambito === "contrato" && e.tipo === "pago" },
  { id: "entregas", label: "ENTREGAS", filtro: (e) => e.familia === "entrega" },
  { id: "novedades", label: "NOVEDADES", filtro: (e) => e.familia === "novedad" },
];
export const SQL_EVENTOS = `
  select ambito, familia, tipo, contract_code, project_code, display_code, contractor_id, contratista,
         gestora, cliente, pais, titulo, accion, estado, dueno, ref, monto_cop, orden,
         to_char(fecha_plan,'YYYY-MM-DD') fp, to_char(fecha_real,'YYYY-MM-DD') fr,
         to_char(fecha_fin,'YYYY-MM-DD') ff
    from metrics.v2_eventos`;
