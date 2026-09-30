import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(project, "web-installer", "corali-installer.php.template");
const outputPath = path.join(project, "corali-web-installer-v51.php");
const accessPath = path.join(project, "corali-web-installer-v51-access.txt");
const archivePath = path.join(project, "corali-pms-cpanel-v51-root.tar.gz");
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const template = await readFile(templatePath, "utf8");
const regularFont=(await readFile(path.join(project,"web-installer","corali-greek-regular.ttf"))).toString("base64");
const boldFont=(await readFile(path.join(project,"web-installer","corali-greek-bold.ttf"))).toString("base64");
const archiveHash=createHash("sha256").update(await readFile(archivePath)).digest("hex");
const stateId=`v51-${archiveHash.slice(0,20)}`;

if (!["__INSTALL_TOKEN_HASH__","__INSTALL_STATE_ID__","__FONT_REGULAR_BASE64__","__FONT_BOLD_BASE64__"].every(key=>template.includes(key))) {
  throw new Error("Web installer placeholders are missing");
}

await writeFile(outputPath, template.replace("__INSTALL_TOKEN_HASH__", tokenHash).replace("__INSTALL_STATE_ID__",stateId).replace("__FONT_REGULAR_BASE64__",regularFont).replace("__FONT_BOLD_BASE64__",boldFont), { mode: 0o600 });
await chmod(outputPath, 0o600);
await writeFile(
  accessPath,
  [
    "Hotel Corali web installer — one-time access",
    "",
    "1. Upload corali-web-installer-v51.php to:",
    "   /home/corali/public_html/corali-installer.php",
    "",
    "2. Upload the release archive and its SHA-256 file to /home/corali/.",
    "",
    "3. Open this private URL:",
    `   https://www.hotelcorali.gr/corali-installer.php?key=${token}`,
    "",
    "4. If the URL key is removed, paste this code into the secure access form:",
    `   ${token}`,
    "",
    "Do not upload this access file. Do not share or screenshot the URL.",
    "The PHP installer deletes itself after successful installation when you press the final button.",
    "",
  ].join("\n"),
  { mode: 0o600 },
);
await chmod(accessPath, 0o600);

console.log(outputPath);
console.log(accessPath);
