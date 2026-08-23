export const SUPPORTED_EMERALD_SHA256 =
  "a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af";

export const SUPPORTED_PAGES = [
  "online",
  "users",
  "chat",
  "party",
  "bag",
  "map",
  "stats",
  "quest",
  "titles",
  "friends",
  "guild",
  "teleport",
  "update",
] as const;

export type StartingPage = (typeof SUPPORTED_PAGES)[number];

export interface LauncherConfig {
  server: string;
  port: number;
  transport: "wss" | "tcp";
  path: string;
  name: string;
  online: boolean;
  page: StartingPage;
}

export const DEFAULT_CONFIG: LauncherConfig = {
  server: "live.emeraldonline3ds.com",
  port: 443,
  transport: "wss",
  path: "/game",
  name: "Trainer",
  online: true,
  page: "online",
};

export function sanitizeTrainerName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!/^[\x20-!#-\[\]-~]{1,12}$/.test(name)) {
    throw new Error(
      "Trainer name must be 1-12 printable ASCII characters without quotes or backslashes.",
    );
  }
  return name;
}

export function sanitizeServerHost(value: unknown): string {
  const host = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!host || host.length > 253 || /[\s/:\\]/.test(host)) {
    throw new Error(
      "Server host must be a hostname or IPv4 address without a scheme, path, or port.",
    );
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    if (ipv4.slice(1).some((part) => Number(part) > 255))
      throw new Error("Server host contains an invalid IPv4 address.");
    return host;
  }
  if (
    host !== "localhost" &&
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      host,
    )
  ) {
    throw new Error("Server host contains invalid hostname characters.");
  }
  return host;
}

export function sanitizeServerPath(value: unknown): string {
  const path = String(value ?? "").trim();
  if (!path.startsWith("/")) throw new Error("Server path must start with /.");
  if (
    path.length > 127 ||
    !/^\/[\x21-\x7e]*$/.test(path) ||
    /[?#\\]/.test(path)
  ) {
    throw new Error("Server path contains unsupported characters.");
  }
  return path;
}

export function normalizeConfig(
  value: Partial<LauncherConfig> = {},
): LauncherConfig {
  const port = Number(value.port ?? DEFAULT_CONFIG.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Port must be an integer between 1 and 65535.");
  const transport = String(
    value.transport ?? DEFAULT_CONFIG.transport,
  ).toLowerCase();
  if (transport !== "wss" && transport !== "tcp")
    throw new Error("Transport must be wss or tcp.");
  const page = String(value.page ?? DEFAULT_CONFIG.page).toLowerCase();
  if (!SUPPORTED_PAGES.includes(page as StartingPage))
    throw new Error("Invalid starting page.");
  return {
    server: sanitizeServerHost(value.server ?? DEFAULT_CONFIG.server),
    port,
    transport,
    path: sanitizeServerPath(value.path ?? DEFAULT_CONFIG.path),
    name: sanitizeTrainerName(value.name ?? DEFAULT_CONFIG.name),
    online:
      value.online === undefined
        ? DEFAULT_CONFIG.online
        : Boolean(value.online),
    page: page as StartingPage,
  };
}

export function encodeOnlineConfig(value: LauncherConfig): string {
  const config = normalizeConfig(value);
  return [
    `server=${config.server}`,
    `port=${config.port}`,
    `transport=${config.transport}`,
    `path=${config.path}`,
    `name=${config.name}`,
    `online=${config.online ? "enabled" : "disabled"}`,
    "dynarec=disabled",
    `page=${config.page}`,
    "",
  ].join("\n");
}

export interface RomHeader {
  title: string;
  gameCode: string;
  makerCode: string;
  version: number;
  headerChecksum: number;
  headerChecksumValid: boolean;
  identityValid: boolean;
}

export function inspectRomHeader(bytes: Uint8Array): RomHeader {
  if (bytes.byteLength !== 16 * 1024 * 1024)
    throw new Error(
      `Expected a 16 MiB GBA ROM, got ${bytes.byteLength} bytes.`,
    );
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end))
      .replace(/\0+$/g, "")
      .trimEnd();
  let checksum = 0;
  for (let index = 0xa0; index <= 0xbc; index += 1)
    checksum = (checksum - bytes[index]) & 0xff;
  checksum = (checksum - 0x19) & 0xff;
  const result = {
    title: ascii(0xa0, 0xac),
    gameCode: ascii(0xac, 0xb0),
    makerCode: ascii(0xb0, 0xb2),
    version: bytes[0xbc],
    headerChecksum: bytes[0xbd],
    headerChecksumValid: checksum === bytes[0xbd],
    identityValid: false,
  };
  result.identityValid =
    result.gameCode === "BPEE" &&
    result.makerCode === "01" &&
    result.version === 0 &&
    result.headerChecksumValid;
  return result;
}
