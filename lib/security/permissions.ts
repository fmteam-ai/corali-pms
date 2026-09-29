export const permissionKeys = [
  "dashboard.read",
  "dashboard.write",
  "reservations.read",
  "reservations.write",
  "reservations.create",
  "reservations.edit",
  "reservations.delete",
  "folios.read",
  "folios.write",
  "rooms.read",
  "rooms.write",
  "rooms.create",
  "rooms.edit",
  "rooms.delete",
  "housekeeping.read",
  "housekeeping.write",
  "maintenance.resolve",
  "pricing.read",
  "pricing.write",
  "pricing.create",
  "pricing.edit",
  "pricing.delete",
  "reports.read",
  "reports.financial",
  "integrations.read",
  "integrations.write",
  "users.manage",
  "audit.read",
] as const;

export type Permission = (typeof permissionKeys)[number];
export type Role = "owner" | "admin" | "reception" | "housekeeping" | "readonly";

/** Staff roles from the specification: Owner, Manager (stored as "admin"), Reception, Housekeeping, Read-only. */
export const roleOrder: Role[] = ["owner", "admin", "reception", "housekeeping", "readonly"];

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  // Unrestricted.
  owner: new Set(permissionKeys),
  // Manager: full operational, financial, reporting and integration access.
  admin: new Set(permissionKeys),
  // Reception: reservations, front desk, guest CRM, basic billing and a view of housekeeping, rooms and rates.
  reception: new Set<Permission>([
    "dashboard.read", "dashboard.write",
    "reservations.read", "reservations.write", "reservations.create", "reservations.edit", "reservations.delete",
    "folios.read", "folios.write",
    "rooms.read", "housekeeping.read", "pricing.read",
    "maintenance.resolve",
  ]),
  // Housekeeping: mobile room status, checklists and damage reports.
  housekeeping: new Set<Permission>(["dashboard.read", "rooms.read", "housekeeping.read", "housekeeping.write", "maintenance.resolve"]),
  // Read-only: occupancy, calendars and non-financial reporting.
  readonly: new Set<Permission>(["dashboard.read", "reservations.read", "rooms.read", "housekeeping.read", "pricing.read", "reports.read"]),
};

/** Parent permission consulted when a granular permission has no explicit override (keeps legacy ".write" overrides working). */
function parentOf(permission: Permission): Permission | null {
  const match = /^(reservations|rooms|pricing)\.(create|edit|delete)$/.exec(permission);
  return match ? (`${match[1]}.write` as Permission) : null;
}

export function can(role: Role, permission: Permission, overrides: Partial<Record<Permission, boolean>> = {}): boolean {
  if (overrides[permission] !== undefined) return overrides[permission] === true;
  const parent = parentOf(permission);
  if (parent && overrides[parent] !== undefined) return overrides[parent] === true;
  return rolePermissions[role].has(permission);
}

export function roleDefault(role: Role, permission: Permission): boolean {
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

/** Module × action matrix shown in the user editor. Empty cells have no corresponding permission. */
export const permissionColumns = ["view", "create", "edit", "delete", "financials", "reports", "settings"] as const;
export type PermissionColumn = (typeof permissionColumns)[number];
export const permissionMatrix: { module: string; cells: Partial<Record<PermissionColumn, Permission>> }[] = [
  { module: "dashboard", cells: { view: "dashboard.read", edit: "dashboard.write" } },
  { module: "reservations", cells: { view: "reservations.read", create: "reservations.create", edit: "reservations.edit", delete: "reservations.delete", financials: "folios.read" } },
  { module: "guests", cells: { view: "reservations.read", edit: "reservations.write" } },
  { module: "folio", cells: { view: "folios.read", edit: "folios.write", financials: "folios.write" } },
  { module: "rooms", cells: { view: "rooms.read", create: "rooms.create", edit: "rooms.edit", delete: "rooms.delete" } },
  { module: "housekeeping", cells: { view: "housekeeping.read", edit: "housekeeping.write" } },
  { module: "maintenance", cells: { view: "housekeeping.read", edit: "maintenance.resolve" } },
  { module: "pricing", cells: { view: "pricing.read", create: "pricing.create", edit: "pricing.edit", delete: "pricing.delete", settings: "pricing.write" } },
  { module: "reports", cells: { reports: "reports.read", financials: "reports.financial" } },
  { module: "integrations", cells: { view: "integrations.read", settings: "integrations.write" } },
  { module: "users", cells: { settings: "users.manage", view: "audit.read" } },
];
