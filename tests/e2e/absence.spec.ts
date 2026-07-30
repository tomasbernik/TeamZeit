import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const mailboxUrl = "http://127.0.0.1:54324";
const employeeEmail = "employee.one@example.test";
const outOfScopeEmployeeEmail = "employee.two@example.test";
const adminEmail = "admin@example.test";
const managerEmail = "manager@example.test";
const auditorEmail = "auditor@example.test";

async function signIn(page: Page, request: APIRequestContext, email: string) {
  await request.delete(`${mailboxUrl}/api/v1/messages`);
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByRole("button", { name: "Mit E-Mail anmelden" }).click();
  await expect(page.getByRole("status")).toContainText("Pruefe dein Postfach");

  let loginLink = "";
  await expect
    .poll(async () => {
      const listResponse = await request.get(`${mailboxUrl}/api/v1/messages`);
      const list = (await listResponse.json()) as {
        messages?: Array<{ ID: string; To?: Array<{ Address: string }> }>;
      };
      const message = list.messages?.find((item) =>
        item.To?.some((recipient) => recipient.Address === email),
      );
      if (!message) return "";

      const messageResponse = await request.get(`${mailboxUrl}/api/v1/message/${message.ID}`);
      const body = (await messageResponse.json()) as { HTML?: string; Text?: string };
      const content = `${body.HTML ?? ""}\n${body.Text ?? ""}`.replaceAll("&amp;", "&");
      loginLink = content.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? "";
      return loginLink;
    }, { timeout: 10_000 })
    .not.toBe("");

  await page.goto(loginLink);
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:5173\/#?$/);
  const navigation = page.getByRole("navigation", { name: "Hauptnavigation" });
  const accessError = page.getByRole("heading", { name: /Zugriff nicht/ });
  await Promise.race([
    navigation.waitFor({ state: "visible" }),
    accessError.waitFor({ state: "visible" }),
  ]);
  if (await accessError.isVisible()) await page.reload();
  await expect(navigation).toBeVisible({ timeout: 15_000 });
}

async function openAbsences(page: Page) {
  await page.getByRole("link", { name: "Abwesenheit" }).click();
  await expect(page.getByRole("heading", { name: "Abwesenheitsanträge" })).toBeVisible();
}

async function submitAbsence(
  page: Page,
  input: { type: "vacation" | "sickness" | "other"; startsOn: string; endsOn: string },
) {
  await page.getByLabel("Art").selectOption(input.type);
  await page.getByLabel("Von").fill(input.startsOn);
  await page.getByLabel("Bis").fill(input.endsOn);
  await page.getByRole("button", { name: "Antrag senden" }).click();
}

test("employee submits an absence request and an administrator approves it", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(60_000);

  const offset = Date.now() % 3_000;
  const startsOn = new Date(Date.UTC(2045, 0, 1 + offset)).toISOString().slice(0, 10);
  const endsOn = new Date(Date.UTC(2045, 0, 5 + offset)).toISOString().slice(0, 10);

  await signIn(page, request, employeeEmail);
  await openAbsences(page);
  await submitAbsence(page, { type: "vacation", startsOn, endsOn });

  const employeeRequest = page
    .locator(".session-row")
    .filter({ hasText: `Urlaub · ${startsOn} – ${endsOn}` })
    .filter({ hasText: "Ausstehend" })
    .last();
  await expect(employeeRequest).toBeVisible();
  await expect(employeeRequest.getByRole("button", { name: "Stornieren" })).toBeVisible();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await signIn(adminPage, request, adminEmail);
    await openAbsences(adminPage);

    const requestToReview = adminPage
      .locator(".session-row")
      .filter({ hasText: `Urlaub · ${startsOn} – ${endsOn}` })
      .filter({ hasText: "Ausstehend" })
      .last();
    await expect(requestToReview).toBeVisible();
    const reviewResponsePromise = adminPage.waitForResponse((response) =>
      response.url().includes("/absences/") &&
      response.url().endsWith("/review") &&
      response.request().method() === "POST",
    );
    await requestToReview.getByRole("button", { name: "Genehmigen" }).click();
    const reviewResponse = await reviewResponsePromise;
    expect(reviewResponse.ok()).toBe(true);
    await expect(reviewResponse.json()).resolves.toMatchObject({
      startsOn,
      endsOn,
      status: "approved",
    });
    await expect(
      adminPage
        .locator(".session-row")
        .filter({ hasText: `Urlaub · ${startsOn} – ${endsOn}` })
        .filter({ hasText: "Genehmigt" })
        .first(),
    ).toBeVisible();
  } finally {
    await adminContext.close();
  }

  await page.reload();
  await expect(
    page
      .locator(".session-row")
      .filter({ hasText: `Urlaub · ${startsOn} – ${endsOn}` })
      .filter({ hasText: "Genehmigt" })
      .first(),
  ).toBeVisible();
});

test("employee cancels a pending absence request", async ({ page, request }) => {
  const startsOn = "2030-09-02";
  const endsOn = "2030-09-03";

  await signIn(page, request, outOfScopeEmployeeEmail);
  await openAbsences(page);
  await submitAbsence(page, { type: "sickness", startsOn, endsOn });

  const pendingRequest = page
    .locator(".session-row")
    .filter({ hasText: `Krankheit · ${startsOn} – ${endsOn}` })
    .filter({ hasText: "Ausstehend" })
    .last();
  await expect(pendingRequest).toBeVisible();

  const cancelResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/absences/") &&
    response.url().endsWith("/cancel") &&
    response.request().method() === "POST",
  );
  await pendingRequest.getByRole("button", { name: "Stornieren" }).click();
  const cancelResponse = await cancelResponsePromise;
  expect(cancelResponse.ok()).toBe(true);
  await expect(cancelResponse.json()).resolves.toMatchObject({
    startsOn,
    endsOn,
    status: "cancelled",
  });
  await expect(
    page
      .locator(".session-row")
      .filter({ hasText: `Krankheit · ${startsOn} – ${endsOn}` })
      .filter({ hasText: "Storniert" })
      .first(),
  ).toBeVisible();
});

test("employee sees a clear error for an overlapping absence request", async ({
  page,
  request,
}) => {
  const offset = Date.now() % 3_000;
  const startsOn = new Date(Date.UTC(2040, 0, 1 + offset)).toISOString().slice(0, 10);
  const endsOn = new Date(Date.UTC(2040, 0, 3 + offset)).toISOString().slice(0, 10);

  await signIn(page, request, outOfScopeEmployeeEmail);
  await openAbsences(page);
  await submitAbsence(page, { type: "vacation", startsOn, endsOn });

  const originalRequest = page
    .locator(".session-row")
    .filter({ hasText: `Urlaub · ${startsOn} – ${endsOn}` })
    .filter({ hasText: "Ausstehend" })
    .last();
  await expect(originalRequest).toBeVisible();

  await submitAbsence(page, { type: "other", startsOn: endsOn, endsOn });
  await expect(page.getByRole("alert")).toContainText(
    "Für diesen Zeitraum besteht bereits eine offene oder genehmigte Abwesenheit.",
  );
  await expect(
    page
      .locator(".session-row")
      .filter({ hasText: `Sonstige · ${endsOn} – ${endsOn}` })
      .filter({ hasText: "Ausstehend" }),
  ).toHaveCount(0);

  await originalRequest.getByRole("button", { name: "Stornieren" }).click();
  await expect(
    page
      .locator(".session-row")
      .filter({ hasText: `Urlaub · ${startsOn} – ${endsOn}` })
      .filter({ hasText: "Storniert" })
      .first(),
  ).toBeVisible();
});

test("administrator rejects a pending absence request", async ({ browser, page, request }) => {
  const startsOn = "2030-10-07";
  const endsOn = "2030-10-09";

  await signIn(page, request, outOfScopeEmployeeEmail);
  await openAbsences(page);
  await submitAbsence(page, { type: "other", startsOn, endsOn });

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await signIn(adminPage, request, adminEmail);
    await openAbsences(adminPage);

    const pendingRequest = adminPage
      .locator(".session-row")
      .filter({ hasText: `Sonstige · ${startsOn} – ${endsOn}` })
      .filter({ hasText: "Ausstehend" })
      .last();
    await expect(pendingRequest).toBeVisible();

    const reviewResponsePromise = adminPage.waitForResponse((response) =>
      response.url().includes("/absences/") &&
      response.url().endsWith("/review") &&
      response.request().method() === "POST",
    );
    await pendingRequest.getByRole("button", { name: "Ablehnen" }).click();
    const reviewResponse = await reviewResponsePromise;
    expect(reviewResponse.ok()).toBe(true);
    await expect(reviewResponse.json()).resolves.toMatchObject({
      startsOn,
      endsOn,
      status: "rejected",
    });
    await expect(
      adminPage
        .locator(".session-row")
        .filter({ hasText: `Sonstige · ${startsOn} – ${endsOn}` })
        .filter({ hasText: "Abgelehnt" })
        .first(),
    ).toBeVisible();
  } finally {
    await adminContext.close();
  }
});

test("manager can review only an in-scope employee absence", async ({
  browser,
  page,
  request,
}) => {
  const scopedStartsOn = "2026-06-20";
  const scopedEndsOn = "2026-06-21";
  const outOfScopeStartsOn = "2026-06-22";
  const outOfScopeEndsOn = "2026-06-23";

  await signIn(page, request, employeeEmail);
  await openAbsences(page);
  await submitAbsence(page, {
    type: "vacation",
    startsOn: scopedStartsOn,
    endsOn: scopedEndsOn,
  });

  const outOfScopeContext = await browser.newContext();
  const outOfScopePage = await outOfScopeContext.newPage();
  try {
    await signIn(outOfScopePage, request, outOfScopeEmployeeEmail);
    await openAbsences(outOfScopePage);
    await submitAbsence(outOfScopePage, {
      type: "other",
      startsOn: outOfScopeStartsOn,
      endsOn: outOfScopeEndsOn,
    });
    const outOfScopeRequest = outOfScopePage
      .locator(".session-row")
      .filter({ hasText: `Sonstige · ${outOfScopeStartsOn} – ${outOfScopeEndsOn}` })
      .filter({ hasText: "Ausstehend" })
      .last();
    await expect(outOfScopeRequest).toBeVisible();
    await outOfScopeRequest.getByRole("button", { name: "Stornieren" }).click();
    await expect(
      outOfScopePage
        .locator(".session-row")
        .filter({ hasText: `Sonstige · ${outOfScopeStartsOn} – ${outOfScopeEndsOn}` })
        .filter({ hasText: "Storniert" })
        .first(),
    ).toBeVisible();
  } finally {
    await outOfScopeContext.close();
  }

  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  try {
    await signIn(managerPage, request, managerEmail);
    await openAbsences(managerPage);

    const inScopeRequest = managerPage
      .locator(".session-row")
      .filter({ hasText: `Urlaub · ${scopedStartsOn} – ${scopedEndsOn}` })
      .filter({ hasText: "Ausstehend" })
      .last();
    await expect(inScopeRequest).toBeVisible();
    await expect(
      managerPage
        .locator(".session-row")
        .filter({ hasText: `Sonstige · ${outOfScopeStartsOn} – ${outOfScopeEndsOn}` }),
    ).toHaveCount(0);

    const reviewResponsePromise = managerPage.waitForResponse((response) =>
      response.url().includes("/absences/") &&
      response.url().endsWith("/review") &&
      response.request().method() === "POST",
    );
    await inScopeRequest.getByRole("button", { name: "Ablehnen" }).click();
    const reviewResponse = await reviewResponsePromise;
    expect(reviewResponse.ok()).toBe(true);
    await expect(reviewResponse.json()).resolves.toMatchObject({
      startsOn: scopedStartsOn,
      endsOn: scopedEndsOn,
      status: "rejected",
    });
  } finally {
    await managerContext.close();
  }
});

test("auditor can read absence statuses but cannot create or review requests", async ({
  page,
  request,
}) => {
  await signIn(page, request, auditorEmail);
  await openAbsences(page);

  await expect(page.locator(".session-row").first()).toBeVisible();
  await expect(page.getByText(/Ausstehend|Genehmigt|Abgelehnt|Storniert/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Antrag senden" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stornieren" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Genehmigen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ablehnen" })).toHaveCount(0);
});
