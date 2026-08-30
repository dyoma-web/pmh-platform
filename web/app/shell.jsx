"use client";
import { usePathname } from "next/navigation";
import Nav from "./nav";

// El armazón interno (raíl + barra superior). Los portales externos
// (/portal/*, /cliente/*) renderizan sin él: solo ven lo suyo.
export default function Shell({ counts, pie, instrumento, children }) {
  const path = usePathname();
  if (path.startsWith("/portal/") || path.startsWith("/cliente/")) {
    return <main>{children}</main>;
  }
  return (
    <div className="lienzo">
      <aside className="rail">
        <div className="wordmark">
          <div className="cota">KOLETO</div>
          <div className="grad" aria-hidden="true" />
          <div className="emisor">INNOVAHUB · GESTIÓN DE PROYECTOS</div>
        </div>
        <Nav counts={counts} />
        <div className="pie">
          {pie.map((l, i) => (<span key={i}>{l}<br /></span>))}
        </div>
      </aside>
      <main>
        <div className="topglobal">
          <form action="/proyectos" method="get">
            <input name="q" placeholder="Buscar proyecto, cliente, gestora o país" aria-label="Buscar" />
          </form>
          <div className="instrumento">{instrumento}</div>
        </div>
        {children}
      </main>
    </div>
  );
}
