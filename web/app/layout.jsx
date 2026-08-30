import "./globals.css";
import { q } from "../lib/db";
import { trmHoy } from "../lib/trm";
import { fechaHora, hoy, n1 } from "../lib/fmt";
import Shell from "./shell";

export const metadata = {
  title: "Cota",
  description: "Sala de máquinas de InnovaHub — gestión administrativa y financiera de proyectos.",
};

export const dynamic = "force-dynamic";

async function contexto() {
  try {
    const [r] = await q(`
      select
        (select max(finished_at) from staging._sync_run) corte,
        (select count(*) from metrics.v2_semaforos) tareas,
        (select count(*) from metrics.v2_portafolio where semaforo='critico') proyectos,
        (select count(*) from metrics.v2_cartera_aging) cartera,
        (select count(*) from procurement.contract_payment
          where adm_validated_at is null and cancelled_at is null
            and (invoice_url is null or legal_support_url is null)) contratacion,
        (select count(*) from infra.item
          where status='on' and end_date<current_date) infraestructura`);
    return r;
  } catch {
    return {};
  }
}

export default async function RootLayout({ children }) {
  const [ctx, trm] = await Promise.all([contexto(), trmHoy()]);
  const counts = {
    "/proyectos": ctx.proyectos,
    "/cartera": ctx.cartera,
    "/contratacion": ctx.contratacion,
    "/infraestructura": ctx.infraestructura,
  };
  const pie = [
    hoy(),
    `CORTE ${ctx.corte ? fechaHora(ctx.corte).toUpperCase() : "LEDGER EN VIVO"}`,
    "VISTA v2 · TRANSACCIONAL",
  ];
  const instrumento = hoy() + (trm ? ` · TRM ${n1(trm)}` : "");

  return (
    <html lang="es-CO" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Petrona:ital,wght@0,400;0,500;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Shell counts={counts} pie={pie} instrumento={instrumento}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
