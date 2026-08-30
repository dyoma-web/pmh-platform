"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function SelectorActor({ usuarios, base }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const actual = sp.get("actor") || "";
  const destino = base || path;
  return (
    <div className="vercomo">
      <span className="notaf" style={{ marginRight: 6 }}>ACTÚA COMO</span>
      {usuarios.map((u) => (
        <a key={u.id}
          className={String(u.id) === actual ? "on" : ""}
          style={{ cursor: "pointer" }}
          onClick={() => router.push(`${destino}?actor=${u.id}`)}>
          {u.full_name}
          {u.puede_validar ? " · adm" : ""}
        </a>
      ))}
    </div>
  );
}
