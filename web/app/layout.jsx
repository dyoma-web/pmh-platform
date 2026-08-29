import "./globals.css";
import { q } from "../lib/db";
import { fechaHora, hoy } from "../lib/fmt";
import Nav from "./nav";

export const metadata = {
  title: "Cota",
  description: "Sala de máquinas de InnovaHub — gestión administrativa y financiera de proyectos.",
};

export const dynamic = "force-dynamic";

async function corte() {
  try {
    const r = await q("select max(finished_at) c from staging._sync_run");
    return r[0]?.c ?? null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }) {
  const c = await corte();
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
            <Nav />
            <div className="pie">
              {hoy()}
              <br />
              CORTE {c ? fechaHora(c).toUpperCase() : "SIN SYNC"}
              <br />
              VISTA v0 · F1 · SOLO LECTURA
            </div>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
