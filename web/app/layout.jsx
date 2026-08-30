import "./globals.css";
import { q } from "../lib/db";
import { trmHoy } from "../lib/trm";
import { fechaHora, hoy, n1 } from "../lib/fmt";
import Nav from "./nav";

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
        (select count(*) from metrics.v0_semaforos) tareas,
        (select count(*) from metrics.v2_portafolio where semaforo='critico') proyectos,
        (select count(*) from metrics.v0_cartera_aging) cartera,
        (select count(*) from staging.contract_payments
          where adm_validation<>'Paid' and (contractor_invoice is null or contractor_legal is null)) contratacion,
        (select count(*) from staging.infra_items
          where status='ON' and end_date::date<current_date) infraestructura`);
    return r;
  } catch {
    return {};
  }
}

export default async function RootLayout({ children }) {
  const [ctx, trm] = await Promise.all([contexto(), trmHoy()]);
  const counts = {
    "/mi-dia": null,
    "/proyectos": ctx.proyectos,
    "/cartera": ctx.cartera,
    "/contratacion": ctx.contratacion,
    "/infraestructura": ctx.infraestructura,
  };
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
        <div className="lienzo">
          <aside className="rail">
            <div className="wordmark">
              <div className="cota">COTA</div>
              <div className="grad" aria-hidden="true" />
              <div className="emisor">INNOVAHUB · GESTIÓN DE PROYECTOS</div>
            </div>
            <Nav counts={counts} />
            <div className="pie">
              {hoy()}
              <br />
              CORTE {ctx.corte ? fechaHora(ctx.corte).toUpperCase() : "SIN SYNC"}
              <br />
              VISTA v0 · F1 · SOLO LECTURA
            </div>
          </aside>
          <main>
            <div className="topglobal">
              <form action="/proyectos" method="get">
                <input
                  name="q"
                  placeholder="Buscar proyecto, cliente, gestora o país"
                  aria-label="Buscar"
                />
              </form>
              <div className="instrumento">
                {hoy()}
                {trm ? ` · TRM ${n1(trm)}` : ""}
              </div>
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
