import { q } from "../../../lib/db";
import { cop, n0, fecha } from "../../../lib/fmt";

export const dynamic = "force-dynamic";

// Portal del cliente: solo lectura, por enlace con token. Hitos y entregables
// de SU proyecto — alto valor percibido, cero superficie de riesgo.

const EH = { scheduled: ["Programado", "pendiente"], invoiced: ["Facturado", "info"],
  partial: ["Abono parcial recibido", "info"], credited: ["Pagado", "correcto"] };

export default async function PortalCliente({ params }) {
  const { token } = await params;
  const [p] = await q(
    `select p.id, p.display_code, p.start_date, p.closing_date, cl.name cliente,
            ges.full_name gestora
     from core.project p
     left join core.client cl on cl.id = p.client_id
     left join core.app_user ges on ges.id = p.pm_id
     where p.client_portal_token = $1`, [token]);

  if (!p) {
    return (
      <div className="portal-ext">
        <CabeceraCliente />
        <section className="plancha"><div className="vacio">
          <div className="t">Este enlace no es válido o fue revocado.</div>
        </div></section>
      </div>
    );
  }

  const hitos = await q(
    `select m.state, m.expected_date, m.deliverables, m.invoice_number, m.credited_date
     from revenue.milestone m where m.project_id = $1 order by m.expected_date`, [p.id]);
  const entregables = await q(
    `select description, due_date, progress_pct from core.deliverable
     where project_id = $1 order by due_date`, [p.id]);
  const avance = entregables.length
    ? entregables.reduce((s, e) => s + Number(e.progress_pct), 0) / entregables.length
    : null;

  return (
    <div className="portal-ext">
      <CabeceraCliente />
      <header className="historia" style={{ padding: "8px 0 0" }}>
        <h1>{p.display_code}</h1>
        <p className="lede">
          {p.cliente} · Gestora del proyecto: {p.gestora}
          {p.closing_date ? ` · cierre previsto ${fecha(p.closing_date)}` : ""}
          {avance != null ? ` · avance físico ${n0(avance)} %` : ""}
        </p>
      </header>

      {entregables.length > 0 && (
        <section className="plancha" style={{ marginTop: 20 }}>
          <h2>Entregables</h2>
          <div className="instr">
            {entregables.map((e, i) => (
              <div className="fila" key={i}>
                <span className="lab">{e.description}</span>
                <span className="mono">compromiso {fecha(e.due_date)}</span>
                <span className={"val " + (Number(e.progress_pct) >= 100 ? "sev correcto" : "")}>
                  {n0(e.progress_pct)} %
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="plancha" style={{ marginTop: 20 }}>
        <h2>Hitos de facturación</h2>
        <div className="instr">
          {hitos.map((h, i) => {
            const [lbl, sev] = EH[h.state] ?? [h.state, "pendiente"];
            return (
              <div className="fila" key={i}>
                <span className="lab">{h.deliverables?.slice(0, 90) ?? `Hito ${i + 1}`}
                  {h.invoice_number ? <span className="mono" style={{ marginLeft: 8 }}>fact. {h.invoice_number}</span> : null}
                </span>
                <span className="mono">{fecha(h.expected_date)}</span>
                <span className={"sev " + sev}>{lbl}</span>
              </div>
            );
          })}
        </div>
      </section>
      <p className="notaf" style={{ margin: "20px 0" }}>
        INNOVAHUB · DOCUMENTO INFORMATIVO · GENERADO AUTOMÁTICAMENTE POR COTA
      </p>
    </div>
  );
}

function CabeceraCliente() {
  return (
    <div style={{ paddingTop: 28 }}>
      <div className="wordmark" style={{ padding: 0 }}>
        <div className="cota">COTA</div>
        <div className="grad" aria-hidden="true" />
        <div className="emisor">INNOVAHUB · SEGUIMIENTO DE PROYECTO</div>
      </div>
    </div>
  );
}
