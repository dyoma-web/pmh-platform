// Caja proyectada a 13 semanas — SVG server-rendered.
// Reglas del manual §12: eje y con marcas y unidad, línea de cero más gruesa,
// sin degradados ni sombras; barras cobros/pagos + línea de saldo acumulado.
import { mcop } from "../lib/fmt";

const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

export default function ChartCaja({ data }) {
  const W = 860, H = 220, padL = 56, padR = 10, padT = 12, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vals = data.flatMap((d) => [
    Number(d.cobros_cop), -Number(d.pagos_cop), Number(d.saldo_cop),
  ]);
  const maxV = Math.max(...vals, 1), minV = Math.min(...vals, 0);
  const y = (v) => padT + ((maxV - v) / (maxV - minV)) * ih;
  const bw = iw / data.length;

  // marcas del eje y: 0, max y min redondeados a centenas de millón
  const paso = Math.max(1e8, Math.round((maxV - minV) / 4 / 1e8) * 1e8);
  const marcas = [];
  for (let v = Math.ceil(minV / paso) * paso; v <= maxV; v += paso) marcas.push(v);
  if (!marcas.includes(0)) marcas.push(0);

  const saldoPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${(padL + bw * i + bw / 2).toFixed(1)},${y(Number(d.saldo_cop)).toFixed(1)}`)
    .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Caja proyectada a 13 semanas"
        style={{ width: "100%", height: "auto", display: "block" }}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)}
              stroke="var(--filete)" strokeWidth={v === 0 ? 1.6 : 1} />
            <text x={padL - 8} y={y(v) + 3} textAnchor="end"
              fontFamily="var(--fx-mono)" fontSize="10" fill="var(--tinta-3)">
              {v === 0 ? "0" : (v > 0 ? "+" : "−") + mcop(Math.abs(v))}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + bw * i;
          const c = Number(d.cobros_cop), p = Number(d.pagos_cop);
          return (
            <g key={i}>
              {c > 0 && (
                <rect x={x + bw * 0.14} width={bw * 0.3} y={y(c)} height={y(0) - y(c)}
                  fill="var(--correcto)" opacity="0.85" />
              )}
              {p > 0 && (
                <rect x={x + bw * 0.52} width={bw * 0.3} y={y(0)} height={y(-p) - y(0)}
                  fill="var(--critico)" opacity="0.8" />
              )}
              <text x={x + bw / 2} y={H - 10} textAnchor="middle"
                fontFamily="var(--fx-mono)" fontSize="9" fill="var(--tinta-3)">
                {i % 2 === 0
                  ? `${new Date(d.semana).getDate()} ${MES[new Date(d.semana).getMonth()]}`
                  : ""}
              </text>
            </g>
          );
        })}
        <path d={saldoPath} fill="none" stroke="var(--tinta-1)" strokeWidth="2" />
      </svg>
      <div className="notaf" style={{ display: "flex", gap: 20, marginTop: 8 }}>
        <span><span style={{ color: "var(--correcto)" }}>▮</span> cobros probables</span>
        <span><span style={{ color: "var(--critico)" }}>▮</span> pagos comprometidos</span>
        <span>— saldo acumulado (sin saldo inicial de caja)</span>
      </div>
    </div>
  );
}
