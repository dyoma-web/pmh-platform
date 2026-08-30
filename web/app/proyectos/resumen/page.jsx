import Link from "next/link";
import { q } from "../../../lib/db";
import { cop, mcop, n0, n1 } from "../../../lib/fmt";
import { slug } from "../../../lib/slug";
import Historia from "../../historia";

export const dynamic = "force-dynamic";

// Resúmenes del portafolio por cliente, gestora o país: el mismo 360 de
// contratistas aplicado a las dimensiones del negocio. Todo sale del ledger.

const DIMS = { cliente: "Cliente", gestora: "Gestora", pais: "País" };
const ORDENES = {
  acreditado: ["Mayor ingreso", "acreditado_cop desc"],
  costeo: ["Mayor costeo", "costeo_cop desc"],
  proyectos: ["Más proyectos", "proyectos desc"],
  nombre: ["Alfabético", "clave asc"],
  pendiente: ["Mayor pendiente", "pendiente_cop desc"],
};
// tonos neutros del sistema para la distribución de líneas (dato, no marca)
const TONOS = ["#3d4a6b", "#5b6884", "#7a86a5", "#98a4c0", "#c2cde6"];

export default async function Resumen({ searchParams }) {
  const sp = await searchParams;
  const por = DIMS[sp?.por] ? sp.por : "cliente";
  const orden = ORDENES[sp?.orden] ? sp.orden : "acreditado";

  const filas = await q(
    `select * from metrics.resumen_dim($1) order by ${ORDENES[orden][1]} nulls last`, [por]);
  const lineasTodas = [...new Set(filas.flatMap((f) => Object.keys(f.lineas || {})))].sort();
  const maxAcred = Math.max(...filas.map((f) => Number(f.acreditado_cop)), 1);
  const top = filas.slice().sort((a, b) => b.acreditado_cop - a.acreditado_cop)[0];
  const totAcred = filas.reduce((s, f) => s + Number(f.acreditado_cop), 0);

  const link = (patch) =>
    `/proyectos/resumen?${new URLSearchParams({ por, orden, ...patch }).toString()}`;
  const filtroPortafolio = (clave) =>
    `/proyectos?estado=Todos&${por === "pais" ? "pais" : por}=${encodeURIComponent(clave)}`;

  return (
    <>
      <Historia
        num="03"
        seccion="Proyectos · Resúmenes"
        titulo={
          top
            ? `${top.clave} concentra el ${n1((100 * top.acreditado_cop) / (totAcred || 1))} % del ingreso acreditado`
            : "Resúmenes del portafolio"
        }
        lede={`El portafolio agregado por ${DIMS[por].toLowerCase()}: cuántos proyectos (activos e históricos), cuánto costeo maneja, cuánto se ha acreditado, cuánto está pendiente por cobrar (con abonos descontados) y cómo se reparte por línea de servicio. Cada fila filtra el portafolio con un clic.`}
        lado={<span className="notaf">FUENTE: LEDGER · {n0(filas.length)} {DIMS[por].toUpperCase()}{filas.length === 1 ? "" : por === "pais" ? "ES" : "S"}</span>}
      />
      <div className="contenido">
        <section className="plancha">
          <div className="vercomo" style={{ marginBottom: 10 }}>
            <span className="notaf" style={{ marginRight: 6 }}>DIMENSIÓN</span>
            {Object.entries(DIMS).map(([k, lbl]) => (
              <Link key={k} href={link({ por: k })} className={k === por ? "on" : ""}>{lbl}</Link>
            ))}
          </div>
          <div className="vercomo">
            <span className="notaf" style={{ marginRight: 6 }}>ORDEN</span>
            {Object.entries(ORDENES).map(([k, [lbl]]) => (
              <Link key={k} href={link({ orden: k })} className={k === orden ? "on" : ""}>{lbl}</Link>
            ))}
          </div>
        </section>

        <section className="plancha">
          <h2>
            Por {DIMS[por].toLowerCase()}{" "}
            <span className="mid">
              LÍNEAS: {lineasTodas.map((l, i) => (
                <span key={l} style={{ marginLeft: 10 }}>
                  <span style={{ display: "inline-block", width: 9, height: 9,
                    background: TONOS[i % TONOS.length], borderRadius: 2,
                    verticalAlign: "-1px", marginRight: 4 }} />{l}
                </span>
              ))}
            </span>
          </h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>{DIMS[por]}</th>
                  <th className="n">Proy.</th>
                  <th className="n">Activos</th>
                  <th className="n">Hist.</th>
                  <th className="n">Costeo</th>
                  <th className="n">Acreditado</th>
                  <th style={{ minWidth: 160 }}>Ingreso acreditado</th>
                  <th className="n">Pendiente</th>
                  <th style={{ minWidth: 140 }}>Líneas</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const totalLineas = Object.values(f.lineas || {}).reduce((s, x) => s + x, 0) || 1;
                  return (
                    <tr key={f.clave}>
                      <td className={"estado " + (Number(f.pendiente_cop) > 0 ? "info" : "correcto")}>
                        {por === "pais" && (
                          <img src={`/img/banderas/${slug(f.clave)}.png`} alt="" width={18} height={13}
                            style={{ verticalAlign: "-1px", marginRight: 6, borderRadius: 2 }} />
                        )}
                        <Link href={filtroPortafolio(f.clave)}>{f.clave}</Link>
                      </td>
                      <td className="n">{n0(f.proyectos)}</td>
                      <td className="n">{n0(f.activos)}</td>
                      <td className="n">{n0(f.historicos)}</td>
                      <td className="n">{f.costeo_cop > 0 ? mcop(f.costeo_cop) + " M" : "—"}</td>
                      <td className="n" style={{ fontWeight: 600 }}>
                        {f.acreditado_cop > 0 ? cop(f.acreditado_cop) : "—"}
                      </td>
                      <td>
                        <span style={{ display: "block", position: "relative", height: 12,
                          background: "var(--surco)", borderRadius: 3 }}>
                          <span style={{ position: "absolute", inset: "0 auto 0 0",
                            width: `${Math.max((Number(f.acreditado_cop) / maxAcred) * 100, f.acreditado_cop > 0 ? 1.5 : 0)}%`,
                            background: "var(--tinta-3)", borderRadius: 3 }} />
                        </span>
                      </td>
                      <td className="n">{f.pendiente_cop > 0 ? mcop(f.pendiente_cop) + " M" : "—"}</td>
                      <td>
                        <span title={Object.entries(f.lineas || {})
                          .map(([l, x]) => `${l}: ${x}`).join(" · ")}
                          style={{ display: "flex", height: 12, borderRadius: 3,
                            overflow: "hidden", background: "var(--surco)" }}>
                          {lineasTodas.map((l, i) =>
                            f.lineas?.[l] ? (
                              <span key={l} style={{
                                width: `${(f.lineas[l] / totalLineas) * 100}%`,
                                background: TONOS[i % TONOS.length] }} />
                            ) : null)}
                        </span>
                        <span className="notaf" style={{ fontSize: 9 }}>
                          {Object.entries(f.lineas || {}).map(([l, x]) => `${l} ${x}`).join(" · ")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                <tr className="total">
                  <td>TOTAL</td>
                  <td className="n">{n0(filas.reduce((s, f) => s + Number(f.proyectos), 0))}</td>
                  <td className="n">{n0(filas.reduce((s, f) => s + Number(f.activos), 0))}</td>
                  <td className="n">{n0(filas.reduce((s, f) => s + Number(f.historicos), 0))}</td>
                  <td className="n">{mcop(filas.reduce((s, f) => s + Number(f.costeo_cop), 0))} M</td>
                  <td className="n">{cop(totAcred)}</td>
                  <td></td>
                  <td className="n">{mcop(filas.reduce((s, f) => s + Number(f.pendiente_cop), 0))} M</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
