"use client";
import { Fragment, useState } from "react";
import { pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { parsePermissions, permissionColumns, permissionMatrix, roleDefault, type Permission, type Role } from "@/lib/security/permissions";

type U = { id: number; username: string; display_name: string; email: string; role: Role; active: number; permissions_json: string; two_factor: boolean };
type Overrides = Partial<Record<Permission, boolean>>;
const assignable: Role[] = ["admin", "reception", "housekeeping", "readonly"];

export function UsersManager({ lang, initial, currentUserId }: { lang: PmsLang; initial: U[]; currentUserId: number }) {
  const t = pmsT(lang);
  const [users, setUsers] = useState(initial);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [role, setRole] = useState<Role>("reception");
  const [overrides, setOverrides] = useState<Overrides>({});
  const [busy, setBusy] = useState(false);
  const roles = assignable;

  async function send(method: "POST" | "PATCH", body: object, success: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/pms/users", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? t("users.saveFailed")); return false; }
      setUsers((v) => (method === "POST" ? [...v, j.user] : v.map((x) => (x.id === j.user.id ? { ...x, ...j.user } : x))));
      setMsg(success);
      return true;
    } catch {
      setMsg(t("users.networkFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function add(f: FormData) {
    await send("POST", Object.fromEntries(f), t("users.created"));
  }
  async function update(f: FormData) {
    if (editing === null) return;
    const body: Record<string, unknown> = Object.fromEntries(f);
    if (!body.password) delete body.password;
    if (editing !== currentUserId) body.permissions = overrides;
    else delete body.role;
    if (await send("PATCH", { id: editing, ...body }, t("users.saved"))) setEditing(null);
  }
  function startEdit(u: U) {
    setEditing(u.id);
    setRole(u.role);
    setOverrides(parsePermissions(u.permissions_json));
  }
  function setCell(key: Permission, value: string) {
    setOverrides((v) => {
      const next = { ...v };
      if (value === "default") delete next[key];
      else next[key] = value === "true";
      return next;
    });
  }

  return (
    <>
      <form action={add} className="adminForm">
        <input name="username" placeholder={t("users.username")} required />
        <input name="displayName" placeholder={t("users.name")} required />
        <input name="email" type="email" placeholder={t("users.email")} required />
        <select name="role" aria-label={t("users.role")}>{roles.map((r) => <option key={r} value={r}>{t(`role.${r}` as PmsKey)}</option>)}</select>
        <input name="password" type="password" minLength={12} placeholder={t("users.password")} required />
        <button disabled={busy}>{t("users.add")}</button>
      </form>
      <p className="notice" role="status">{msg}</p>
      <div className="tableWrap">
        <table>
          <thead><tr><th>{t("users.user")}</th><th>{t("users.email")}</th><th>{t("users.role")}</th><th>{t("users.twoFactor")}</th><th>{t("users.status")}</th><th>{t("users.actions")}</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.display_name}<small>{u.username}</small></td>
                <td>{u.email}</td>
                <td>{t(`role.${u.role}` as PmsKey)}</td>
                <td>{u.two_factor ? "✓" : "—"}</td>
                <td>{u.active ? t("users.active") : t("users.inactive")}</td>
                <td className="rowActions">
                  <button disabled={busy} onClick={() => startEdit(u)}>{t("users.edit")}</button>
                  {u.id !== currentUserId && <button disabled={busy} onClick={() => send("PATCH", { id: u.id, active: !u.active }, t("users.saved"))}>{u.active ? t("users.deactivate") : t("users.activate")}</button>}
                  <button disabled={busy} onClick={() => confirm(t("users.revokeConfirm", { name: u.display_name })) && send("PATCH", { id: u.id, revokeSessions: true }, t("users.revoked"))}>{t("users.revoke")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing !== null && users.filter((u) => u.id === editing).map((u) => (
        <form key={u.id} action={update} className="policyForm userEditor">
          <h2>{t("users.editing", { name: u.display_name })}</h2>
          <label>{t("users.name")}<input name="displayName" defaultValue={u.display_name} required /></label>
          <label>{t("users.email")}<input name="email" type="email" defaultValue={u.email} required /></label>
          {u.id !== currentUserId && u.role !== "owner" && (
            <label>{t("users.role")}
              <select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>{roles.map((r) => <option key={r} value={r}>{t(`role.${r}` as PmsKey)}</option>)}</select>
              <small>{t(`role.${role}.desc` as PmsKey)}</small>
            </label>
          )}
          <label>{t("users.newPassword")}<input name="password" type="password" minLength={12} placeholder={t("users.passwordHint")} /></label>
          {u.id !== currentUserId && u.role !== "owner" && (
            <fieldset className="permissionMatrix">
              <legend>{t("users.matrix")}</legend>
              <p>{t("users.matrixHint")}</p>
              <div className="tableWrap">
                <table>
                  <thead><tr><th />{permissionColumns.map((c) => <th key={c}>{t(`col.${c}` as PmsKey)}</th>)}</tr></thead>
                  <tbody>
                    {permissionMatrix.map((row) => (
                      <tr key={row.module}>
                        <th scope="row">{t(`mod.${row.module}` as PmsKey)}</th>
                        {permissionColumns.map((column) => {
                          const key = row.cells[column];
                          if (!key) return <td key={column} className="empty" />;
                          const value = overrides[key];
                          const effective = value ?? roleDefault(role, key);
                          return (
                            <Fragment key={column}>
                              <td className={value === undefined ? "inherit" : value ? "allow" : "deny"}>
                                <select aria-label={`${t(`mod.${row.module}` as PmsKey)} · ${t(`col.${column}` as PmsKey)}`} value={value === undefined ? "default" : String(value)} onChange={(e) => setCell(key, e.target.value)}>
                                  <option value="default">{t("users.byRole")} ({effective ? "✓" : "✗"})</option>
                                  <option value="true">{t("users.allow")}</option>
                                  <option value="false">{t("users.deny")}</option>
                                </select>
                              </td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
          )}
          <div className="actions"><button disabled={busy}>{t("users.save")}</button><button type="button" onClick={() => setEditing(null)}>{t("users.cancel")}</button></div>
        </form>
      ))}
    </>
  );
}
