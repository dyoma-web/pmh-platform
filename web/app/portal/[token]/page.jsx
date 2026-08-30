import { q } from "../../../lib/db";
import { cop, fecha } from "../../../lib/fmt";
import SubirPortal from "./subir";

export const dynamic = "force-dynamic";

// Portal del contratista: entra por enlace con token (sin cuenta). Ve SOLO sus
// pagos y sube su cuenta de cobro y soporte de seguridad social — la causa raíz
// de los 150 pagos sin soporte, atacada donde nace.

export default async function Portal({ params }) {
  const { token } = await params;
  const [c] = await q(
    "select id, display_name from procurement.contractor where portal_token=$1", [token]);

  if (!c) {
    return (
      <div className="portal-ext">
        <Cabecera />
        <section className="plancha"><div className="vacio">
          <div className="t">Este enlace no es válido o fue revocado.</div>
          <div className="d">Pide un enlace nuevo a administración de InnovaHub.</div>
        </div></section>
      </div>
    );
  }

  const pagos = await q(
    `select cp.id, cp.due_date, cp.amount, cp.invoice_url, cp.legal_support_url,
            cp.authorized_at, cp.adm_validated_at, cp.cancelled_at,
            k.code contrato, p.display_code proyecto
     from procurement.contract_payment cp
     join procurement.contract k on k.code = cp.contract_code
     join core.project p on p.id = k.project_id
     where k.contractor_id = $1
     order by cp.adm_validated_at is not null, cp.due_date`, [c.id]);
  const pendientes = pagos.filter((p) => !p.adm_validated_at && !p.cancelled_at);
  const faltantes = pendientes.filter((p) => !p.invoice_url || !p.legal_support_url).length;

  return (
    <div className="portal-ext">
      <Cabecera />
      <header className="historia" style={{ padding: "8px 0 0" }}>
        <h1>Hola, {c.display_name.split(" ")[0]}</h1>
        <p className="lede">
          {faltantes > 0
            ? `${faltantes === 1 ? "Un pago necesita" : faltantes + " pagos necesitan"} tus documentos para poder pagarse: sube la cuenta de cobro y el soporte de seguridad social aquí mismo. Sin ellos, administración no puede validar.`
            : "Tus documentos están completos. Aquí ves el estado de cada pago."}
        </p>
      </header>

      <section className="plancha" style={{ marginTop: 20 }}>
        <h2>Tus pagos</h2>
        {pagos.map((p) => {
          const estado = p.cancelled_at ? ["anulado", "pendiente"]
            : p.adm_validated_at ? [`pagado el ${fecha(p.adm_validated_at)}`, "correcto"]
            : p.authorized_at ? ["autorizado · en validación", "info"]
            : ["en trámite", "alerta"];
          return (
            <div className={"tarea " + estado[1]} key={p.id}>
              <div className="cuerpo" style={{ paddingLeft: 4 }}>
                <div className="t">{cop(p.amount)} · {p.proyecto}</div>
                <div className="code">{p.contrato} · programado {fecha(p.due_date)}</div>
                <div className="d"><span className={"sev " + estado[1]}>{estado[0]}</span></div>
              </div>
              {!p.adm_validated_at && !p.cancelled_at && (
                <SubirPortal token={token} pago={p} />
              )}
            </div>
          );
        })}
      </section>
      <p className="notaf" style={{ margin: "20px 0" }}>
        INNOVAHUB · COTA · ESTE ENLACE ES PERSONAL — NO LO COMPARTAS
      </p>
    </div>
  );
}

function Cabecera() {
  return (
    <div style={{ paddingTop: 28 }}>
      <div className="wordmark" style={{ padding: 0 }}>
        <div className="cota">COTA</div>
        <div className="grad" aria-hidden="true" />
        <div className="emisor">INNOVAHUB · PORTAL DE CONTRATISTAS</div>
      </div>
    </div>
  );
}
