"use client";
import { useRouter, useSearchParams } from "next/navigation";

export default function SelectorActor({ usuarios }) {
  const router = useRouter();
  const sp = useSearchParams();
  const actual = sp.get("actor") || "";
  return (
    <div className="vercomo">
      <span className="notaf" style={{ marginRight: 6 }}>FIRMA COMO</span>
      {usuarios.map((u) => (
        <a key={u.id}
          className={String(u.id) === actual ? "on" : ""}
          style={{ cursor: "pointer" }}
          onClick={() => router.push(`/contratacion/firmas?actor=${u.id}`)}>
          {u.full_name}
          {u.puede_validar ? " · adm" : ""}
        </a>
      ))}
    </div>
  );
}
