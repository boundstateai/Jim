// Generates a JIM_PASSWORD_HASH value. The password is read from stdin so it
// never lands in shell history, a file, or process arguments.
//
//   node scripts/hash-password.mjs
//   (type the password, then press Enter)
//
// Put the printed value in JIM_PASSWORD_HASH on the hosting provider.
// Changing it signs out every existing session.
import { hashPassword } from "../api/_lib/session.js";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");

if (!password) {
  console.error("No password received on stdin.");
  process.exit(1);
}

console.log(hashPassword(password));
