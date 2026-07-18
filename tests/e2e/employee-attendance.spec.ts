import { expect, test } from "@playwright/test";

const mailboxUrl = "http://127.0.0.1:54324";
const employeeEmail = "employee.two@example.test";

test.beforeEach(async ({ request }) => {
  await request.delete(`${mailboxUrl}/api/v1/messages`);
});

test("employee signs in and completes a workday with a break", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(employeeEmail);
  await page.getByRole("button", { name: "Mit E-Mail anmelden" }).click();
  await expect(page.getByRole("status")).toContainText("Pruefe dein Postfach");

  let loginLink = "";
  await expect
    .poll(async () => {
      const listResponse = await request.get(`${mailboxUrl}/api/v1/messages`);
      const list = (await listResponse.json()) as { messages?: Array<{ ID: string; To?: Array<{ Address: string }> }> };
      const message = list.messages?.find((item) => item.To?.some((recipient) => recipient.Address === employeeEmail));
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
  await expect(page.getByRole("heading", { name: "Heute", level: 1 })).toBeVisible();

  const status = page.getByText("Ausgestempelt", { exact: true });
  await expect(status).toBeVisible();

  await page.getByRole("button", { name: "Einstempeln" }).click();
  await expect(page.getByText("Eingestempelt", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ausstempeln" }).click();
  await expect(status).toBeVisible();
  await expect(page.locator(".session-row")).toHaveCount(1);

  await page.getByRole("button", { name: "Einstempeln" }).click();
  await expect(page.getByText("Eingestempelt", { exact: true })).toBeVisible();
  await expect(page.locator(".session-row")).toHaveCount(2);

  await page.getByRole("button", { name: "Ausstempeln" }).click();
  await expect(status).toBeVisible();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await expect(page.locator(".summary-row")).toContainText("Arbeitszeit");
  await expect(page.locator(".summary-row")).toContainText("Pause");
});
