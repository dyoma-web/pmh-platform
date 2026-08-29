import { q } from "../../lib/db";
import { n0, cop, fechaHora } from "../../lib/fmt";
import Historia from "../historia";

export const dynamic = "force-dynamic";

const CONTROL = {
  proyectos: { label: "Proyectos en maestro", esperado: 144, tipo: "n" },
  ingreso_esperado_cop: { label: "Ingreso esperado", esperado: 6619987381, tipo: "cop" },
  ingreso_acreditado_cop: { label: "Ingreso acreditado", esperado: 5274778319, tipo: "cop" },
  cartera_pendiente_cop: { label: "Cartera pendiente", esperado: 1337427462, tipo: "cop" },
  cartera_vencida_cop: { label: "Cartera vencida", esperado: null, tipo: "cop" },
  costos_cop: { label: "Costos contables", esperado: 2523325222, tipo: "cop" },
  contratos_monto_cop: { label: "Contratos con terceros", esperado: 829681600, tipo: "cop" },
  contratos_n: { label: "Contratos (n)", esperado: 221, tipo: "n" },
};

export default async function Calidad() {
  const control = await q("select * from metrics.v0_cifras_control");
  const runs = await q(
    "select * from staging._sync_run order by finished_at desc limit 8"
  );
  const huerfanos = await q(`
    select count(*) n, sum(amount) m from staging.v_costs_norm
    where norm_accion = 'directo' and project_code_canon not in
      (select project_code from staging.projects) and project_code is not null`);

  const controlables = control.filter((c) => CONTROL[c.metrica]?.esperado != null);
  const ok = controlables.filter((c) => {
    const cfg = CONTROL[c.metrica];
    return Math.abs(Number(c.valor) - cfg.esperado) / Math.max(cfg.esperado, 1) < 0.001;
  }).length;
  const todoOk = ok === controlables.length;

  return (
    <>
      <Historia
        num="08"
        seccion="Administración · Calidad de datos"
        titulo={
          todoOk
            ? "Puedes confiar en lo que ves"
            : `${n0(controlables.length - ok)} controles no reconcilian`
        }
        lede={
          todoOk
            ? `Los ${n0(ok)} controles fijos reconcilian con el corte contable del 27 de agosto, y la cartera vencida se mueve solo porque el tiempo pasa. Esta pantalla existe para que la confianza no sea un acto de fe: cuando algo no cuadre, aquí aparece primero, con el monto exacto de la diferencia.`
            : `Hasta que estos controles vuelvan a cuadrar, trata las cifras de las demás pantallas como provisionales. Aquí está cuál falla y por cuánto.`
        }
        lado={<span className="notaf">M10 · DUEÑO: DATA STEWARD</span>}
      />

      <div className="contenido">
        <section className="plancha">
          <h2>
            Cifras de control <span className="mid">DOCS/02 ANEXO B · CORTE 27 AGO 2026</span>
          </h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Métrica</th>
                  <th className="n">Valor actual</th>
                  <th className="n">Control (27 ago)</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {control.map((c) => {
                  const cfg = CONTROL[c.metrica] ?? { label: c.metrica, esperado: null, tipo: "n" };
                  const val = Number(c.valor);
                  const ok =
                    cfg.esperado == null ||
                    Math.abs(val - cfg.esperado) / Math.max(cfg.esperado, 1) < 0.001;
                  return (
                    <tr key={c.metrica}>
                      <td className={"estado " + (ok ? "correcto" : "alerta")}>{cfg.label}</td>
                      <td className="n" style={{ fontWeight: 600 }}>
                        {cfg.tipo === "cop" ? cop(val) : n0(val)}
                      </td>
                      <td className="n">
                        {cfg.esperado == null
                          ? "vive con el tiempo"
                          : cfg.tipo === "cop"
                            ? cop(cfg.esperado)
                            : n0(cfg.esperado)}
                      </td>
                      <td>
                        <span className={"sev " + (ok ? "correcto" : "alerta")}>
                          {cfg.esperado == null ? "sin control fijo" : ok ? "reconcilia" : "revisar"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>
              Huérfanos residuales en costos <span className="mid">TRAS ALIAS F0</span>
            </h2>
            {Number(huerfanos[0].n) === 0 ? (
              <div className="vacio">
                <div className="t">Cero asientos huérfanos.</div>
                <div className="d">La tabla de alias de F0 cubre todos los códigos de costos.</div>
              </div>
            ) : (
              <div className="instr">
                <div className="fila">
                  <span className="lab">
                    Asientos cuyo código no existe en el maestro ni en la tabla de alias
                  </span>
                  <span className="val" style={{ color: "var(--alerta)" }}>
                    {n0(huerfanos[0].n)} · {cop(huerfanos[0].m)}
                  </span>
                </div>
              </div>
            )}
            <p style={{ fontSize: 12, color: "var(--tinta-2)", marginBottom: 0 }}>
              Los códigos con acción «crear_proyecto_histórico» dejan de contar aquí cuando los
              proyectos históricos se creen en F2.
            </p>
          </section>

          <section className="plancha">
            <h2>
              Corridas de sincronización <span className="mid">staging._sync_run</span>
            </h2>
            <div className="instr">
              {runs.map((r) => (
                <div className="fila" key={r.id}>
                  <span className="lab mono" style={{ fontFamily: "var(--fx-mono)", fontSize: 12 }}>
                    {fechaHora(r.finished_at)}
                  </span>
                  <span className="mono">{n0(r.tables_loaded)} tablas</span>
                  <span className="val">{n0(r.rows_total)} filas</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
