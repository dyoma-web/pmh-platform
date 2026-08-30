import Link from "next/link";
import { q } from "../../../lib/db";
import { n0, n1, cop, mcop } from "../../../lib/fmt";
import Historia from "../../historia";
import SelectorActor from "../firmas/selector-actor";

export const dynamic = "force-dynamic";

const ER = { en_vinculacion: ["En vinculación", "info"], activo: ["Activo", "correcto"],
  inactivo: ["Inactivo", "pendiente"], no_elegible: ["No elegible", "critico"] };

export default async function Contratistas({ searchParams }) {
  const sp = await searchParams;
  const actorId = sp?.actor || "";
  const tipo = sp?.tipo || "";
  const buscar = (sp?.q || "").trim();

  const usuarios = await q(`
    select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);
  const filas = await q(
    `select * from metrics.v2_contratista_360
     where ($1 = '' or kind = $1)
       and ($2 = '' or display_name ilike '%'||$2||'%' or profile ilike '%'||$2||'%')
     order by percibido_cop desc nulls last`, [tipo, buscar]);

  const sinEval = filas.reduce((s, f) => s + Number(f.evaluaciones_pendientes || 0), 0);
  const top = filas[0];

  return (
    <>
      <Historia
        num="04"
        seccion="Contratación · Contratistas"
        titulo={
          top
            ? `${top.display_name} concentra el ${n1(top.concentracion_pct)} % del gasto en terceros`
            : "Directorio de contratistas"
        }
        lede={`Expediente 360 por contratista: cuánto ha percibido, qué le debemos, con qué gestoras trabaja y ha trabajado, cómo lo evaluamos y cómo cobra frente a sus pares. El listado sigue sin datos personales — el contacto se abre por acción registrada. ${sinEval > 0 ? `Hay ${n0(sinEval)} contratos terminados sin evaluar: cada uno es memoria que se está perdiendo.` : "Todas las evaluaciones al día."}`}
        lado={
          <>
            <span className="notaf">EVALUACIONES Y COMPARADOR: SOLO INTERNO</span>
            <Link className="btn" href="/contratacion/comparador">Comparador por producto</Link>
          </>
        }
      />
      <div className="contenido">
        <section className="plancha">
          <SelectorActor usuarios={usuarios} />
          <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            {actorId && <input type="hidden" name="actor" value={actorId} />}
            <input name="q" defaultValue={buscar} placeholder="Nombre o perfil" className="mini"
              style={{ flex: "1 1 220px", height: 40 }} />
            <select name="tipo" defaultValue={tipo} className="mini" style={{ height: 40, width: 190 }}>
              <option value="">Personas y empresas</option>
              <option value="natural">Solo personas naturales</option>
              <option value="juridica">Solo empresas</option>
            </select>
            <button className="btn" type="submit">Filtrar directorio</button>
          </form>
        </section>

        <section className="plancha">
          <h2>Directorio <span className="mid">{n0(filas.length)} · ORDENADO POR MONTO PERCIBIDO</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Contratista</th><th>Tipo</th><th>Perfil</th>
                  <th className="n">Percibido</th><th className="n">Pendiente</th>
                  <th className="n">Contratos</th><th>Gestoras actuales</th>
                  <th className="n">Eval.</th><th>Docs</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const [lbl, sev] = ER[f.relation_state] ?? [f.relation_state, "pendiente"];
                  return (
                    <tr key={f.id}>
                      <td className={"estado " + sev}>
                        <Link href={`/contratacion/contratistas/${f.id}${actorId ? `?actor=${actorId}` : ""}`}>
                          {f.display_name}
                        </Link>
                      </td>
                      <td>{f.kind === "juridica" ? "Empresa" : "Persona"}</td>
                      <td style={{ fontSize: 12 }}>{f.profile ?? "—"}</td>
                      <td className="n" style={{ fontWeight: 600 }}>
                        {f.percibido_cop > 0 ? cop(f.percibido_cop) : "—"}
                      </td>
                      <td className="n">{f.pendiente_cop > 0 ? cop(f.pendiente_cop) : "—"}</td>
                      <td className="n">{n0(f.contratos_activos)}/{n0(f.contratos_total)}</td>
                      <td style={{ fontSize: 12 }}>{(f.gestoras_actuales ?? []).join(", ") || "—"}</td>
                      <td className="n">
                        {f.eval_promedio != null
                          ? <span className={"sev " + (Number(f.eval_promedio) >= 4 ? "correcto" : Number(f.eval_promedio) >= 3 ? "alerta" : "critico")}>{n1(f.eval_promedio)}</span>
                          : "·"}
                      </td>
                      <td>
                        {Number(f.docs_vencidos) > 0
                          ? <span className="sev alerta">{n0(f.docs_vencidos)} venc.</span>
                          : Number(f.docs_vigentes) > 0
                            ? <span className="sev correcto">{n0(f.docs_vigentes)} ✓</span>
                            : <span className="sev pendiente">sin exp.</span>}
                      </td>
                      <td><span className={"sev " + sev}>{lbl}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
