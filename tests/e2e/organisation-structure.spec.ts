import { expect, test } from "@playwright/test";
const mailboxUrl="http://127.0.0.1:54324";
const adminEmail="admin@example.test";
test.beforeEach(async({request})=>{await request.delete(`${mailboxUrl}/api/v1/messages`);});
test("administrator opens all organisation structure sections",async({page,request})=>{
  await page.goto("/login");await page.getByLabel("E-Mail").fill(adminEmail);await page.getByRole("button",{name:"Mit E-Mail anmelden"}).click();
  let link="";
  await expect.poll(async()=>{const list=await (await request.get(`${mailboxUrl}/api/v1/messages`)).json() as {messages?:Array<{ID:string;To?:Array<{Address:string}>}>};const item=list.messages?.find(x=>x.To?.some(y=>y.Address===adminEmail));if(!item)return "";const body=await (await request.get(`${mailboxUrl}/api/v1/message/${item.ID}`)).json() as {HTML?:string;Text?:string};link=`${body.HTML??""}\n${body.Text??""}`.replaceAll("&amp;","&").match(/https?:\/\/[^\s"'<>]+/)?.[0]??"";return link;},{timeout:10_000}).not.toBe("");
  await page.goto(link);await page.getByRole("link",{name:"Struktur"}).click();
  await expect(page.getByRole("heading",{name:"Organisationsstruktur"})).toBeVisible();
  for(const heading of ["Standorte","Teams","Teamzuordnung","Manager-Bereich"])await expect(page.getByRole("heading",{name:heading})).toBeVisible();
});
