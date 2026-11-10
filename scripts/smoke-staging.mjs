import assert from "node:assert/strict";

try {
  const origin = new URL(process.argv[2] ?? "");
  const isLocal = origin.protocol === "http:" && origin.hostname === "127.0.0.1";
  if ((!isLocal && origin.protocol !== "https:") || origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Supply the HTTPS origin of the StudyOS deployment.");
  }

  const request = (path) => fetch(new URL(path, origin), {
    redirect: "manual",
    signal: AbortSignal.timeout(75_000),
  });
  const login = await request("/login");
  assert.equal(login.status, 200, "/login should return 200");
  const html = await login.text();
  assert.ok(html.includes("StudyOS") && html.includes('name="email"') && html.includes('name="password"'),
    "/login should render the configured StudyOS sign-in form");
  console.log("StudyOS sign-in form is available.");

  for (const path of ["/dashboard", "/library", "/settings"]) {
    const response = await request(path);
    await response.body?.cancel();
    assert.ok([302, 303, 307, 308].includes(response.status), path + " should redirect a signed-out visitor");
    const location = new URL(response.headers.get("location") ?? "", origin);
    assert.ok(location.origin === origin.origin && location.pathname === "/login",
      path + " should redirect to this deployment's sign-in page");
    console.log(path + " is protected.");
  }
} catch (error) {
  console.error("Staging smoke check failed. " + (error instanceof Error ? error.message : "Unknown error"));
  process.exitCode = 1;
}
