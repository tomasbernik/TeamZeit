import { buildApp } from "./app.js";
import { readApiConfig } from "./config/env.js";

const config = readApiConfig();
const app = buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
