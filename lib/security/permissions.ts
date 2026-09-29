export const permissionKeys = [
  "dashboard.read",
  "dashboard.write",
  "reservations.read",
  "reservations.write",
  "reservations.create",
  "reservations.edit",
  "folios.read",
  "folios.write",
  "rooms.read",
  "rooms.write",
  "rooms.create",
  "rooms.edit",
  "housekeeping.read",
  "housekeeping.write",
  "pricing.read",
  "pricing.write",
  "pricing.create",
  "pricing.edit",
  "reports.read",
  "integrations.read",
  "integrations.write",
  "users.manage",
] as const;

export type Permission = (typeof permissionKeys)[number];
export type Role = "owner" | "admin" | "reception" | "housekeeping" | "readonly";

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(permissionKeys),
  admin: new Set(permissionKeys),
  reception: new Set(permissionKeys.filter((key) => !key.startsWith("users.") && !key.startsWith("integrations.write"))),
  housekeeping: new Set(["dashboard.read", "rooms.read", "housekeeping.read", "housekeeping.write"]),
  readonly: new Set(permissionKeys.filter((key) => key.endsWith(".read"))),
};

export function can(role: Role, permission: Permission, overrides: Partial<Record<Permission, boolean>> = {}): boolean {
  if (overrides[permission] !== undefined) return overrides[permission] === true;
  const parent = permission.replace(/\.(create|edit)$/, ".write") as Permission;
  if (parent !== permission) {
    if (overrides[parent] !== undefined) return overrides[parent] === true;
    return rolePermissions[role].has(parent);
  }
  return rolePermissions[role].has(permission);
}

export function parsePermissions(value: string): Partial<Record<Permission, boolean>> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(permissionKeys.filter((key) => typeof parsed[key] === "boolean").map((key) => [key, parsed[key]]));
  } catch {
    return {};
  }
}
