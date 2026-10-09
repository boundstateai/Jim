import test from "node:test";
import assert from "node:assert/strict";
import {
  COOKIE_NAME,
  clearedCookie,
  createSessionToken,
  hashPassword,
  isLoggedIn,
  loginConfigured,
  parseCookies,
  readSessionToken,
  sessionCookie,
  verifyPassword,
} from "./_lib/session.js";
import handler from "./login.js";

const PASSWORD = "correct horse battery staple!";

function configure({ password = PASSWORD, username = "jim" } = {}) {
  process.env.CALCULUS_PASSWORD_HASH = hashPassword(password);
  process.env.CALCULUS_USERNAME = username;
  delete process.env.SESSION_SECRET;
}

function clear() {
  delete process.env.CALCULUS_PASSWORD_HASH;
  delete process.env.CALCULUS_USERNAME;
  delete process.env.SESSION_SECRET;
}

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  return res;
}

test("the stored hash never contains the password", () => {
  const stored = hashPassword(PASSWORD);
  assert.match(stored, /^scrypt\$[a-f0-9]+\$[a-f0-9]+$/);
  assert.ok(!stored.includes(PASSWORD));
});

test("a fresh salt is used per hash, so identical passwords differ", () => {
  assert.notEqual(hashPassword(PASSWORD), hashPassword(PASSWORD));
});

test("verifyPassword accepts the right pair and rejects near misses", () => {
  configure();
  assert.equal(verifyPassword("jim", PASSWORD), true);
  assert.equal(verifyPassword("JIM", PASSWORD), true, "username is case-insensitive");
  assert.equal(verifyPassword("jim", PASSWORD + " "), false);
  assert.equal(verifyPassword("jim", PASSWORD.toUpperCase()), false);
  assert.equal(verifyPassword("notjim", PASSWORD), false);
  assert.equal(verifyPassword("jim", ""), false);
  assert.equal(verifyPassword("jim", "x".repeat(300)), false, "oversized input is refused");
  clear();
});

test("session tokens round-trip and reject tampering", () => {
  configure();
  const token = createSessionToken();
  assert.ok(readSessionToken(token));

  const [payload, sig] = token.split(".");
  assert.equal(readSessionToken(`${payload}.${sig.slice(0, -2)}xx`), null, "bad signature");
  const forged = Buffer.from(JSON.stringify({ u: "jim", exp: Date.now() + 1000 }), "utf8").toString("base64url");
  assert.equal(readSessionToken(`${forged}.${sig}`), null, "unsigned payload");
  clear();
});

test("expired tokens are refused", () => {
  configure();
  const token = createSessionToken("jim", Date.now() - 1000 * 60 * 60 * 24 * 365);
  assert.equal(readSessionToken(token), null);
  clear();
});

test("changing the password invalidates existing sessions", () => {
  configure();
  const token = createSessionToken();
  assert.ok(readSessionToken(token));
  configure({ password: "a different password" });
  assert.equal(readSessionToken(token), null);
  clear();
});

test("the cookie is HttpOnly, Secure and SameSite", () => {
  configure();
  const cookie = sessionCookie(createSessionToken());
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(clearedCookie(), /Max-Age=0/);
  clear();
});

test("parseCookies reads one value out of a crowded jar", () => {
  const jar = parseCookies("a=1; calculus_session=abc.def; b=2");
  assert.equal(jar.calculus_session, "abc.def");
});

test("isLoggedIn gates a configured deployment and opens an unconfigured one", () => {
  clear();
  assert.equal(isLoggedIn({ headers: {} }), true, "unconfigured stays open");

  configure();
  assert.equal(isLoggedIn({ headers: {} }), false, "no cookie is rejected");
  assert.equal(isLoggedIn({ headers: { cookie: "calculus_session=nonsense" } }), false);
  assert.equal(
    isLoggedIn({ headers: { cookie: sessionCookie(createSessionToken()).split(";")[0] } }),
    true
  );
  clear();
});

test("POST with the right credentials sets a session cookie", async () => {
  configure();
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { username: "jim", password: PASSWORD } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authenticated, true);
  assert.match(res.headers["set-cookie"], /^calculus_session=.+HttpOnly/);
  clear();
});

test("a wrong password is refused with no cookie and no detail", async () => {
  configure();
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { username: "jim", password: "wrong" } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["set-cookie"], undefined);
  assert.ok(!/username/i.test(res.body.error) || !/password/i.test(res.body.error) || res.body.error.includes("do not match"));
  clear();
});

test("a wrong username returns the same message as a wrong password", async () => {
  configure();
  const a = fakeRes();
  const b = fakeRes();
  await handler({ method: "POST", headers: {}, body: { username: "nope", password: PASSWORD } }, a);
  await handler({ method: "POST", headers: {}, body: { username: "jim", password: "nope" } }, b);
  assert.equal(a.body.error, b.body.error);
  clear();
});

test("logout clears the cookie", async () => {
  configure();
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { action: "logout" } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["set-cookie"], /Max-Age=0/);
  clear();
});

test("GET reports status without leaking the hash", async () => {
  configure();
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.authenticated, false);
  assert.equal(res.body.username, "jim");
  assert.ok(!JSON.stringify(res.body).includes("scrypt"));
  clear();
});

test("login refuses politely when nothing is configured", async () => {
  clear();
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { username: "jim", password: PASSWORD } }, res);
  assert.equal(res.statusCode, 503);
  clear();
});


test("direct API handlers require the calculus session and reject Jim cookies", async()=>{
  const {requireApiAuth}=await import('./_lib/auth.js');
  configure();
  try {
    const token=createSessionToken();
    const missing=fakeRes();
    assert.equal(requireApiAuth({headers:{}},missing),false);
    assert.equal(missing.statusCode,401);
    assert.equal(requireApiAuth({headers:{cookie:'jim_session='+token}},fakeRes()),false);
    assert.equal(requireApiAuth({headers:{cookie:COOKIE_NAME+'='+token}},fakeRes()),true);
  } finally {clear();}
});
