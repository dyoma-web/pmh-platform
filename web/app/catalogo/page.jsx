import { q } from "../../lib/db";
import { cop, n0 } from "../../lib/fmt";

export const dynamic = "force-dynamic";

export default async function Catalogo() {
  const tarifas = await q(
    "select * from ref.tarifario_provisional order by monto_total desc nulls last");
  const [cob] = await q(`
    select sum(monto_total) cubierto,
           (select sum(price_total) from staging.request_services) total
    from ref.tarifario_provisional`);
  const pct = cob.total ? (100 * Number(cob.cubierto)) / Number(cob.total) : 0;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Catálogo IHPSC</h1>
          <div className="sub">
            Tarifario provisional: mediana de precios realmente pagados en 2026.
          </div>
        </div>
        <div className="meta">M11 · cobertura {n0(pct)} % del monto vendido · umbral 80 %</div>
      </div>

      <div className="contenido">
        <section className="plancha">
          <h2>
            Costos de referencia <span className="mid">{n0(tarifas.length)} ÍTEMS · COP · PROVISIONAL</span>
          </h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Ítem IHPSC</th>
                  <th className="n">Líneas 2026</th>
                  <th className="n">Monto vendido</th>
                  <th className="n">P. mín</th>
                  <th className="n">Costo ref. (mediana)</th>
                  <th className="n">P. máx</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {tarifas.map((t) => (
                  <tr key={t.ihpsc_item}>
                    <td className="estado pendiente" style={{ whiteSpace: "normal", minWidth: 220 }}>
                      {t.ihpsc_item}
                    </td>
                    <td className="n">{n0(t.lineas)}</td>
                    <td className="n">{cop(t.monto_total)}</td>
                    <td className="n">{cop(t.p_min)}</td>
                    <td className="n" style={{ fontWeight: 600 }}>{cop(t.costo_ref_provisional_cop)}</td>
                    <td className="n">{cop(t.p_max)}</td>
                    <td><span className="sev alerta">provisional</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: "var(--tinta-2)", margin: "12px 0 0" }}>
            Fuente: 131 líneas de servicio reales de 2026 mapeadas por palabra clave al catálogo
            v3.1. El taller de tarifas (issue #10) ratifica o ajusta cada mediana; al aprobarse, el
            estado pasa a «validado» con su evidencia de contrato.
          </p>
        </section>

        <section className="plancha">
          <h2>Qué falta para que el catálogo opere <span className="mid">RUTA F2/F4</span></h2>
          <div className="instr">
            <div className="fila">
              <span className="lab">Cargar el maestro v3.1 completo (308 ítems) al esquema catalog</span>
              <span className="sev pendiente">F2</span>
            </div>
            <div className="fila">
              <span className="lab">Tarifas por perfil (37 perfiles, hoy 0 con tarifa)</span>
              <span className="sev pendiente">taller</span>
            </div>
            <div className="fila">
              <span className="lab">Crosswalk códigos v1 ↔ v3.1 para presupuesto e infraestructura</span>
              <span className="sev pendiente">F2</span>
            </div>
            <div className="fila">
              <span className="lab">Cotizador: armar una OS desde el catálogo con precio defendible</span>
              <span className="sev pendiente">F8</span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
